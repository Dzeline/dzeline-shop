import { useEffect, useRef } from "react";

// A USB/Bluetooth barcode scanner is a keyboard: it "types" the code and
// presses Enter, far faster than a person can. These two numbers are what
// separate the two.
const MAX_GAP_MS = 50;  // fast human typing is ~80-150ms between keys
const MIN_LENGTH = 6;   // shorter bursts are someone using the keyboard

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

/**
 * Listen for a keyboard-wedge barcode scanner anywhere in the app.
 *
 * Deliberately inert while focus is inside a field: there, the cashier is
 * either typing or scanning *into* that field (the barcode input on Add
 * Product, say), and in both cases the keystrokes belong to the field.
 *
 * @param onScan   called with the decoded string
 * @param enabled  gate it off where a stray scan shouldn't add to the cart
 */
export function useWedgeScanner(onScan, { enabled = true } = {}) {
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; });

  const buffer = useRef({ chars: [], last: 0 });

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e) {
      if (isEditable(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = performance.now();
      const buf = buffer.current;
      if (now - buf.last > MAX_GAP_MS) buf.chars = [];
      buf.last = now;

      if (e.key === "Enter") {
        const code = buf.chars.join("");
        buf.chars = [];
        if (code.length >= MIN_LENGTH) {
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      // Codes are alphanumeric (plus a few separators); anything else means
      // this burst was not a scan.
      if (e.key.length === 1 && /[0-9A-Za-z\-_.]/.test(e.key)) {
        buf.chars.push(e.key);
      } else {
        buf.chars = [];
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
