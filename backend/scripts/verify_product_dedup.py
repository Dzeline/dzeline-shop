"""
Does the server refuse to create the same product twice?

    cd backend && python scripts/verify_product_dedup.py

Two staff each add the same item on their own till. Neither row has a cloud id,
so both are pushed as new, and until now the server made two products - after
which every device pulled both. One tin of Blue Band became four rows with its
stock split between them, and no single row was ever low enough to trigger a
reorder.

The client now avoids duplicating on pull as well, but this is the layer that
stops two rows ever existing, which is the only version that converges.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.database import Base  # noqa: E402
from app import models  # noqa: E402,F401
from app.models import Product  # noqa: E402
from app.routers.products import _find_twin, _is_fabricated_barcode, _normalise_name  # noqa: E402
from app.schemas import ProductIn  # noqa: E402

failures = []


def check(label, ok, detail=""):
    print(f"{'  ok  ' if ok else '  FAIL'}  {label}{f' - {detail}' if detail else ''}")
    if not ok:
        failures.append(label)


fd, path = tempfile.mkstemp(suffix=".db")
os.close(fd)

try:
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()

    TENANT, OTHER_TENANT = 1, 2

    def add(name, barcode=None, tenant_id=TENANT, device="till-a", local=1):
        product = Product(
            tenant_id=tenant_id, device_id=device, local_id=local,
            name=name, barcode=barcode, price=100, stock=5, updated_at=0,
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        return product

    def incoming(name, barcode=None, device="till-b", local=99):
        return ProductIn(device_id=device, local_id=local, name=name, barcode=barcode, price=100)

    blue = add("Blue Band 250g", None, local=1)
    sugar = add("Sugar 1kg", "6161117772045", local=2)
    invented = add("Omo 500g", "1790416489648", local=3)          # old client's fake
    other_shop = add("Blue Band 250g", None, tenant_id=OTHER_TENANT, device="far", local=1)

    print("\n-- the same product from another till --")
    twin = _find_twin(db, TENANT, incoming("Blue Band 250g"))
    check("an unbarcoded product is recognised by name", twin is not None and twin.id == blue.id,
          f"matched {getattr(twin, 'id', None)}, expected {blue.id}")
    twin = _find_twin(db, TENANT, incoming("  blue   BAND 250g  "))
    check("case and spacing do not matter", twin is not None and twin.id == blue.id,
          f"matched {getattr(twin, 'id', None)}")
    twin = _find_twin(db, TENANT, incoming("Sugar 1kg", "6161117772045"))
    check("a barcode that already exists is recognised", twin is not None and twin.id == sugar.id,
          f"matched {getattr(twin, 'id', None)}")
    twin = _find_twin(db, TENANT, incoming("Omo 500g"))
    check("a product whose stored barcode was invented is still matched by name",
          twin is not None and twin.id == invented.id, f"matched {getattr(twin, 'id', None)}")

    print("\n-- what it must never merge --")
    twin = _find_twin(db, TENANT, incoming("Royco Cubes"))
    check("a genuinely new product is not matched", twin is None,
          f"matched {getattr(twin, 'id', None)}")
    twin = _find_twin(db, TENANT, incoming("Sugar 1kg", "6009999999999"))
    check("two different real barcodes are different products, same name or not",
          twin is None, f"matched {getattr(twin, 'id', None)}")
    twin = _find_twin(db, OTHER_TENANT, incoming("Blue Band 250g"))
    check("another shop's product is never returned to this one",
          twin is not None and twin.id == other_shop.id,
          f"matched {getattr(twin, 'id', None)}, expected {other_shop.id}")
    twin = _find_twin(db, TENANT, incoming(""))
    check("a nameless, barcodeless push matches nothing rather than everything",
          twin is None, f"matched {getattr(twin, 'id', None)}")

    print("\n-- the invented-barcode rule --")
    check("a millisecond timestamp is treated as invented",
          _is_fabricated_barcode("1790416489648") is True)
    check("a Kenyan EAN-13 is not", _is_fabricated_barcode("6161117772045") is False)
    check("a short code is not", _is_fabricated_barcode("1287") is False)
    check("an empty value is not a barcode at all", _is_fabricated_barcode("") is False)
    check("names normalise consistently",
          _normalise_name("  Blue   BAND  250g ") == "blue band 250g",
          _normalise_name("  Blue   BAND  250g "))

    db.close()
finally:
    try:
        os.unlink(path)
    except OSError:
        pass

print()
if failures:
    print(f"{len(failures)} failed:\n  - " + "\n  - ".join(failures))
    sys.exit(1)
print("All product dedup checks passed.")
