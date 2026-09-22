import { useEffect, useRef } from "react";

/**
 * Close the topmost overlay on Escape.
 *
 * Every modal in the app is dismissible by tapping outside or hitting a close
 * button, which is all a touchscreen needs — on a desktop till, Escape is the
 * expected way out, and without it a cashier reaches for the mouse.
 *
 * Listeners are stacked: the most recently mounted overlay handles the key and
 * stops there, so Escape inside a confirm dialog layered over a modal closes
 * only the dialog.
 */
const stack = [];

export function useEscapeKey(onEscape, enabled = true) {
  const handlerRef = useRef(onEscape);
  useEffect(() => { handlerRef.current = onEscape; });

  useEffect(() => {
    if (!enabled) return;

    const entry = { run: () => handlerRef.current?.() };
    stack.push(entry);

    function handleKeyDown(e) {
      if (e.key !== "Escape") return;
      if (stack[stack.length - 1] !== entry) return; // not the topmost overlay
      e.stopPropagation();
      entry.run();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
    };
  }, [enabled]);
}
