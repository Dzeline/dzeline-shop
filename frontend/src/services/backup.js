/**
 * A backup file the shop owns.
 *
 * Sync keeps the device and the cloud in agreement; neither is a backup,
 * because both converge on the *current* state. This is the copy that does not
 * — a file the owner can keep, mail to themselves, or hand to an accountant,
 * and that works with no backend at all.
 *
 * Two rules shape the format:
 *
 * It is **self-describing**. The schema version, the row counts and when it was
 * taken travel inside the file, so a restore can refuse a file it cannot honour
 * instead of half-importing it.
 *
 * It is **verified on write**. The counts are re-read from the database after
 * the file is built and compared against what went into it, so a truncated or
 * partial export fails now — not on the day somebody needs it.
 */
import { db, dbHelpers } from "./db";
import { businessDate } from "./shifts";

// Every table worth keeping. `print_jobs` is deliberately absent: it is a
// transient outbox that is deleted once pushed, so restoring one would reprint
// old receipts.
export const BACKUP_TABLES = [
  "products",
  "transactions",
  "transaction_items",
  "pending_mpesa",
  "staff",
  "settings",
  "stock_receipts",
  "stock_receipt_items",
  "suppliers",
  "purchase_orders",
  "purchase_order_items",
  "supplier_payments",
  "shifts",
  "cash_movements",
  "void_reasons",
];

// Base64 images dominate the file size, and a 200MB file will not leave a phone
// over a Kenyan mobile connection.
const PHOTO_FIELDS = { products: ["image_blob"], stock_receipts: ["photo_blob"] };

export const BACKUP_FORMAT = 1;

function stripPhotos(table, rows) {
  const fields = PHOTO_FIELDS[table];
  if (!fields) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const f of fields) if (copy[f]) copy[f] = null;
    return copy;
  });
}

export const backup = {
  BACKUP_TABLES,

  /**
   * Build a backup of everything.
   *
   * @param includePhotos  false drops product images and invoice photos, which
   *                       is usually the difference between a file that can be
   *                       sent and one that cannot
   * @param onProgress     (table, index, total) — a full export is slow enough
   *                       on a phone to need saying so
   */
  async create({ includePhotos = true, onProgress } = {}) {
    const tables = {};
    const counts = {};

    for (let i = 0; i < BACKUP_TABLES.length; i++) {
      const name = BACKUP_TABLES[i];
      onProgress?.(name, i, BACKUP_TABLES.length);
      // A table added in a later schema version may not exist on this device.
      let rows;
      try {
        rows = await db.table(name).toArray();
      } catch {
        rows = [];
      }
      tables[name] = includePhotos ? rows : stripPhotos(name, rows);
      counts[name] = rows.length;
    }

    const settings = await dbHelpers.getShopSettings().catch(() => ({}));

    const payload = {
      meta: {
        format: BACKUP_FORMAT,
        schema_version: db.verno,
        exported_at: Date.now(),
        shop_name: settings?.shop_name ?? null,
        device_id: await dbHelpers.getDeviceId().catch(() => null),
        includes_photos: includePhotos,
        counts,
      },
      tables,
    };

    // Verified on write: re-read the counts and compare. A file that is short a
    // table has to fail here, where it can be retried, and not silently.
    const mismatches = [];
    for (const name of BACKUP_TABLES) {
      let actual;
      try {
        actual = await db.table(name).count();
      } catch {
        actual = 0;
      }
      if (actual !== (counts[name] ?? 0)) {
        mismatches.push(`${name}: wrote ${counts[name] ?? 0}, database has ${actual}`);
      }
    }
    if (mismatches.length) {
      throw new Error(`Backup did not match the database — ${mismatches.join("; ")}`);
    }

    return payload;
  },

  /** A filename a person can recognise a year later. */
  filename(meta) {
    const slug = (meta?.shop_name || "dzeline")
      .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // The shop's own date, not UTC. `toISOString()` would stamp a backup taken
    // before 3am in Nairobi with yesterday's date, which is exactly the kind of
    // detail that makes somebody restore the wrong file.
    const date = businessDate(new Date(meta?.exported_at ?? Date.now()));
    return `${slug}-backup-${date}${meta?.includes_photos ? "" : "-nophotos"}.json`;
  },

  /**
   * What a file contains, without importing it.
   *
   * Restoring replaces everything, so the person doing it deserves to see what
   * they are about to get first.
   */
  inspect(payload) {
    if (!payload || typeof payload !== "object" || !payload.meta || !payload.tables) {
      throw new Error("This is not a Dzeline backup file");
    }
    if (payload.meta.format !== BACKUP_FORMAT) {
      throw new Error(`Unrecognised backup format (${payload.meta.format})`);
    }
    // A file from a newer version of the app may hold tables and fields this
    // build has never heard of. Refusing is the honest answer.
    if ((payload.meta.schema_version ?? 0) > db.verno) {
      throw new Error(
        `This backup is from a newer version of the app (schema ${payload.meta.schema_version}, this device is ${db.verno}). Update the app first.`,
      );
    }
    const counts = payload.meta.counts ?? {};
    return {
      shopName: payload.meta.shop_name,
      exportedAt: payload.meta.exported_at,
      schemaVersion: payload.meta.schema_version,
      includesPhotos: payload.meta.includes_photos !== false,
      counts,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
      sales: counts.transactions ?? 0,
      products: counts.products ?? 0,
    };
  },

  /**
   * Restore a backup over this device.
   *
   * Replace, not merge. Merging two divergent copies of a shop's history needs
   * conflict rules nobody can state, and quietly producing a third version that
   * matches neither is worse than being told to start clean.
   *
   * The device's own identity is preserved: taking on the backup's device_id
   * would make this till indistinguishable from the one that made the file, and
   * sync uses that id to tell "mine" from "foreign".
   */
  async restore(payload, { onProgress } = {}) {
    const summary = this.inspect(payload);
    const myDeviceId = await dbHelpers.getDeviceId().catch(() => null);

    const names = BACKUP_TABLES.filter((n) => payload.tables[n]);
    const restored = {};

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      onProgress?.(name, i, names.length);
      const rows = payload.tables[name];
      if (!Array.isArray(rows)) continue;
      try {
        await db.table(name).clear();
        if (rows.length) await db.table(name).bulkPut(rows);
        restored[name] = rows.length;
      } catch (err) {
        // A table this build does not have is not a reason to abandon the rest
        // of the restore — the alternative is losing everything else too.
        console.error(`Restore skipped ${name}:`, err);
        restored[name] = 0;
      }
    }

    // Keep this device's own identity, and force a full re-sync afterwards so
    // the cloud and the restored copy reconcile rather than silently diverge.
    if (myDeviceId) {
      await db.settings.put({ key: "device_id", value: myDeviceId });
    }
    await db.settings.delete("last_txn_pull_at").catch(() => {});
    await db.settings.delete("payments_pulled_at").catch(() => {});

    return { summary, restored };
  },
};
