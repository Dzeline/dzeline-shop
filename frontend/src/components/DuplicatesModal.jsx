import { useEffect, useState } from "react";
import { findDuplicates, suggestSurvivor, previewMerge, mergeProducts } from "../services/mergeProducts";
import { formatPrice } from "../utils/formatters";
import { showToast } from "../utils/toast";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { syncService } from "../services/sync";

/**
 * One group of duplicates, and the choice of which row to keep.
 *
 * The rows are shown with everything that differs between them — barcode, price,
 * stock — because that is what somebody needs in order to pick, and a merge
 * cannot be undone.
 */
function Group({ group, onMerged }) {
  const [keepId, setKeepId] = useState(() => suggestSurvivor(group.products).id);
  const [busy, setBusy] = useState(false);

  const survivor = group.products.find((p) => p.id === keepId) ?? group.products[0];
  const others = group.products.filter((p) => p.id !== keepId);
  const result = previewMerge(survivor, others);

  async function run() {
    setBusy(true);
    try {
      const outcome = await mergeProducts(keepId, others.map((p) => p.id));
      showToast(
        `Merged ${outcome.mergedCount + 1} entries into one — ${outcome.stock} in stock`,
      );
      syncService.pushUnsyncedProducts().catch(() => {});
      onMerged();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Could not merge those products");
      setBusy(false);
    }
  }

  return (
    <div className="bg-gray-800 rounded-2xl p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-white truncate">{survivor.name}</p>
        <p className="text-xs text-gray-400 shrink-0">{group.products.length} entries</p>
      </div>

      <div className="space-y-1.5">
        {group.products.map((product) => {
          const keeping = product.id === keepId;
          return (
            <button
              key={product.id}
              onClick={() => setKeepId(product.id)}
              disabled={busy}
              className={`w-full text-left rounded-xl px-3 py-2 border-2 transition ${
                keeping
                  ? "border-primary bg-primary/10"
                  : "border-gray-700 bg-gray-900 hover:border-gray-600"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${
                  keeping ? "border-primary bg-primary" : "border-gray-600"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-200 truncate">{product.name}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {product.price > 0 ? formatPrice(product.price) : "no price"}
                    {" · "}{product.stock ?? 0} in stock
                    {product.barcode ? ` · ${product.barcode}` : " · no barcode"}
                    {product.cloud_id == null ? " · not synced" : ""}
                  </p>
                </div>
                {keeping && (
                  <span className="text-[10px] font-bold text-primary shrink-0">KEEP</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="bg-gray-900 rounded-xl px-3 py-2">
        <p className="text-[11px] text-gray-400 leading-relaxed">
          Keeps <span className="text-white font-semibold">{survivor.name}</span> with{" "}
          <span className="text-white font-semibold">{result.stock} in stock</span>
          {result.barcode ? <> and barcode <span className="text-white">{result.barcode}</span></> : null}
          {result.price ? <> at <span className="text-white">{formatPrice(result.price)}</span></> : null}.
          {" "}The other {others.length === 1 ? "entry" : `${others.length} entries`} {others.length === 1 ? "is" : "are"} removed.
        </p>
      </div>

      <button
        onClick={run}
        disabled={busy || others.length === 0}
        className="w-full py-2 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-40"
      >
        {busy ? "Merging…" : "Merge into one"}
      </button>
    </div>
  );
}

/**
 * Duplicate products, and a way to end them.
 *
 * Why it matters, in the shop rather than in the data: stock spread across two
 * entries means neither is ever low enough to trigger a reorder, so the shelf
 * runs empty while the system reports plenty.
 */
export default function DuplicatesModal({ onClose, onChanged }) {
  useEscapeKey(onClose);
  const [groups, setGroups] = useState(null);

  const load = () => findDuplicates().then(setGroups).catch(() => setGroups([]));
  useEffect(() => { load(); }, []);

  return (
    <div className="fixed inset-0 z-70 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-gray-900 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90dvh] flex flex-col">
        <div className="px-5 pt-5 pb-3 border-b border-gray-800 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-white">Duplicate products</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {groups === null
                  ? "Looking…"
                  : groups.length === 0
                  ? "None found"
                  : `${groups.length} product${groups.length === 1 ? "" : "s"} entered more than once`}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {groups === null ? (
            <p className="text-sm text-gray-500 text-center py-8">Checking the catalogue…</p>
          ) : groups.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm font-semibold text-gray-300">Nothing is duplicated</p>
              <p className="text-xs text-gray-500 mt-1">
                Every product in your catalogue appears once.
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-400 leading-relaxed">
                The same product entered twice splits its stock between the entries, so neither
                is ever low enough to trigger a reorder and the shelf runs empty while the
                system says there is plenty. Merging adds the stock together and keeps one
                entry. It cannot be undone.
              </p>
              {groups.map((group) => (
                <Group
                  key={group.products.map((p) => p.id).join("-")}
                  group={group}
                  onMerged={() => { load(); onChanged?.(); }}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
