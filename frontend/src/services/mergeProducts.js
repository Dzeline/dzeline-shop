/**
 * Fixing duplicate products that already exist.
 *
 * Prevention landed first (productIdentity.js, and the checks in sync, the
 * importer and the add form), but every shop that has been running already has
 * duplicates, and they are not harmless: one tin of Blue Band spread across three
 * rows shows 4 + 3 + 5 in stock instead of 12, so the reorder alert never fires
 * on any of them and the shelf runs empty while the system reports plenty.
 *
 * Merging is destructive and cannot be undone, so nothing here decides anything
 * by itself. The screen shows the groups, a person picks which row survives, and
 * this carries out exactly that.
 */
import { db } from "./db";
import { realBarcode, findDuplicateGroups } from "../utils/productIdentity";

/**
 * Duplicate groups in this device's catalogue, worst first.
 *
 * Soft-deleted products are left out: they are already gone as far as the shop is
 * concerned, and offering to merge them would be offering to resurrect them.
 */
export async function findDuplicates() {
  const products = await db.products.filter((p) => p.active !== false).toArray();
  return findDuplicateGroups(products);
}

/**
 * Which row a group should keep, as a starting suggestion.
 *
 * The one that can actually be sold and scanned: a real barcode first, then a
 * price, then the most stock, then the one that has been synced (so other devices
 * already know it). The person doing the merge can pick a different one.
 */
export function suggestSurvivor(products) {
  return [...products].sort((a, b) => {
    const barcodeDiff = Number(Boolean(realBarcode(b))) - Number(Boolean(realBarcode(a)));
    if (barcodeDiff) return barcodeDiff;
    const priceDiff = Number((b.price ?? 0) > 0) - Number((a.price ?? 0) > 0);
    if (priceDiff) return priceDiff;
    const stockDiff = (b.stock ?? 0) - (a.stock ?? 0);
    if (stockDiff) return stockDiff;
    return Number(b.cloud_id != null) - Number(a.cloud_id != null);
  })[0];
}

/**
 * What the surviving product looks like afterwards.
 *
 * Pure, so the screen can show the result before anything is written.
 *
 * Stock is summed, because the stock exists: it is on the shelf, and it was only
 * ever recorded against two rows. Everything else fills a gap rather than
 * overwriting - a price on the survivor is not replaced by another row's price,
 * because nobody can say which is current, but a survivor with no price takes one
 * that exists. Guessing wrong about stock is visible at the next count; guessing
 * wrong about price is money.
 */
export function previewMerge(survivor, duplicates) {
  const merged = {
    stock: (survivor.stock ?? 0) + duplicates.reduce((sum, p) => sum + (p.stock ?? 0), 0),
  };

  if (!realBarcode(survivor)) {
    const withBarcode = duplicates.find((p) => realBarcode(p));
    if (withBarcode) merged.barcode = realBarcode(withBarcode);
  }
  if (!survivor.price) {
    const priced = duplicates.find((p) => p.price > 0);
    if (priced) merged.price = priced.price;
  }
  if (survivor.cost_price == null) {
    const costed = duplicates.find((p) => p.cost_price != null);
    if (costed) merged.cost_price = costed.cost_price;
  }
  if (!survivor.image_blob) {
    const pictured = duplicates.find((p) => p.image_blob);
    if (pictured) merged.image_blob = pictured.image_blob;
  }
  if (!survivor.category || survivor.category === "Other") {
    const categorised = duplicates.find((p) => p.category && p.category !== "Other");
    if (categorised) merged.category = categorised.category;
  }
  // The highest reorder level of the group, since the merged row now carries all
  // the stock the separate rows did and needs a threshold to match.
  const levels = [survivor, ...duplicates].map((p) => p.reorder_level ?? 0);
  merged.reorder_level = Math.max(...levels) || 10;

  return merged;
}

/**
 * Merge a group into one product.
 *
 * The duplicates are soft-deleted rather than removed, for the same reason every
 * other delete here is: a tombstone propagates, and a hard delete on one device
 * is silently resurrected by the next pull from another.
 *
 * History is repointed rather than left dangling. Past sale lines carry their own
 * name and price, so reports would survive either way, but anything that groups
 * by product - profit per product, stock movement, what is on order - would
 * otherwise keep reporting the merged rows separately, which is the problem this
 * is meant to end.
 *
 * @returns { survivorId, mergedCount, stock, movedLines }
 */
export async function mergeProducts(survivorId, duplicateIds) {
  const ids = duplicateIds.filter((id) => id !== survivorId);
  if (ids.length === 0) return { survivorId, mergedCount: 0, stock: 0, movedLines: 0 };

  return db.transaction(
    "rw",
    [db.products, db.transaction_items, db.stock_receipt_items, db.purchase_order_items],
    async () => {
      const survivor = await db.products.get(survivorId);
      if (!survivor) throw new Error("The product to keep no longer exists.");
      const duplicates = (await Promise.all(ids.map((id) => db.products.get(id)))).filter(Boolean);
      if (duplicates.length === 0) {
        return { survivorId, mergedCount: 0, stock: survivor.stock ?? 0, movedLines: 0 };
      }

      const merged = previewMerge(survivor, duplicates);
      await db.products.update(survivorId, {
        ...merged,
        synced: false,
        updated_at: Date.now(),
      });

      let movedLines = 0;
      for (const table of [db.transaction_items, db.stock_receipt_items, db.purchase_order_items]) {
        for (const id of ids) {
          const lines = await table.where("product_id").equals(id).toArray();
          for (const line of lines) {
            await table.update(line.id, { product_id: survivorId });
            movedLines++;
          }
        }
      }

      for (const duplicate of duplicates) {
        await db.products.update(duplicate.id, {
          active: false,
          deleted_at: Date.now(),
          // Zeroed so that if this row is ever looked at again it cannot be
          // mistaken for stock the shop still has - the count moved to the
          // survivor and counting it twice is the whole problem.
          stock: 0,
          synced: false,
          updated_at: Date.now(),
        });
      }

      return {
        survivorId,
        mergedCount: duplicates.length,
        stock: merged.stock,
        movedLines,
      };
    },
  );
}
