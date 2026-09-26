"""
Keep the database's columns in step with the models.

`create_all` builds missing *tables* complete, and never touches a table that
already exists — so a column added to a model after its table was created has to
be ALTERed in by hand. main.py keeps a hand-written list of those, and
hand-written lists drift: twice now a column reached models.py and never reached
the list.

The failure mode is what makes this worth automating. The ORM SELECTs every
mapped column unconditionally, so one missing column does not degrade an
endpoint — it 500s it, for every tenant, the moment anybody has a row in that
table. `GET /suppliers` returning nothing but errors is indistinguishable, from
the shop's side, from the whole system being down.

So this derives the same work from the models and closes whatever the list
missed. Deliberately narrow: it only ever ADDs. Dropping a column, narrowing a
type or rewriting a constraint all need somebody to decide what happens to the
data already in there, and a boot-time script is the wrong place for that.
"""
import logging

from sqlalchemy import inspect as sa_inspect, text

from .database import Base
# Imported for its side effect: Base.metadata only knows the tables whose model
# classes have been imported, and a table missing from metadata is a table this
# never checks.
from . import models  # noqa: F401

logger = logging.getLogger("dzeline.schema")


def add_column_sql(table_name, col, dialect):
    """
    The ALTER for one missing column, plus a note if something was relaxed.

    Pure, so the decisions can be tested without a database: what type, what
    default, and whether NOT NULL is safe to assert on a table that already has
    rows in it.

    Returns (sql, note) — note is None when the column goes in exactly as the
    model declares it.
    """
    typ = col.type.compile(dialect=dialect)
    clause = typ
    note = None

    # NOT NULL is only addable alongside a default, because the rows already in
    # the table need a value for it. A model default that is a plain scalar can
    # supply one; a lambda or a sequence cannot.
    model_default = getattr(col.default, "arg", None) if col.default is not None else None
    scalar_default = model_default if isinstance(model_default, (int, float, str, bool)) else None

    if col.server_default is not None:
        # The model already states what the database should default to, and
        # CreateColumn would have emitted it — leave it to the column type.
        pass
    elif scalar_default is not None:
        literal = f"'{scalar_default}'" if isinstance(scalar_default, str) else str(scalar_default)
        clause += f" DEFAULT {literal}"
        if not col.nullable:
            clause += " NOT NULL"
    elif not col.nullable:
        note = (
            f"{table_name}.{col.name} added as NULLable: the model says NOT NULL but "
            "gives no default for the rows already there"
        )

    return (
        f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col.name} {clause}",
        note,
    )


def missing_columns(conn):
    """
    Every column a model declares that the database has not got.

    Returns [(table, column)] in metadata order. A table absent entirely is
    skipped — that is create_all's job, and it builds it complete.
    """
    insp = sa_inspect(conn)
    present_tables = set(insp.get_table_names())
    gaps = []

    for table in Base.metadata.sorted_tables:
        if table.name not in present_tables:
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name not in have:
                gaps.append((table, col))
    return gaps


def reconcile_model_columns(conn):
    """Add the missing columns, and say loudly which ones needed adding."""
    try:
        gaps = missing_columns(conn)
    except Exception as exc:
        logger.warning("Schema reconcile skipped (cannot inspect): %s", exc)
        return []

    added = []
    for table, col in gaps:
        try:
            sql, note = add_column_sql(table.name, col, conn.dialect)
        except Exception as exc:
            logger.error("Schema reconcile cannot type %s.%s: %s", table.name, col.name, exc)
            continue
        if note:
            logger.warning("Schema reconcile: %s", note)

        try:
            conn.execute(text(sql))
            conn.commit()
            added.append(f"{table.name}.{col.name}")
        except Exception as exc:
            conn.rollback()
            logger.error("Schema reconcile FAILED %s.%s: %s", table.name, col.name, exc)
            continue

        # A column the model wants indexed gets its index here too: ALTER TABLE
        # ADD COLUMN does not create one, and an unindexed since-filter on a
        # growing table is the kind of thing that only hurts once it is too late.
        if col.index:
            try:
                conn.execute(text(
                    f"CREATE INDEX IF NOT EXISTS ix_{table.name}_{col.name} "
                    f"ON {table.name} ({col.name})"
                ))
                conn.commit()
            except Exception as exc:
                conn.rollback()
                logger.warning("Index skipped %s.%s: %s", table.name, col.name, exc)

    if added:
        # Loud on purpose. Every name here is a column the hand-written list
        # should have carried, and an endpoint that would otherwise have 500d.
        logger.warning("Schema reconcile added missing columns: %s", ", ".join(added))
    else:
        logger.info("Schema reconcile: models and database agree")
    return added
