import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query from JS.
 *
 * Only for cases where the *behaviour* differs, not just the styling — e.g.
 * the cart is a navigable panel on a phone but a permanent rail on a desktop,
 * so the nav tab itself has to disappear. Anything that is purely visual
 * should use Tailwind's breakpoint prefixes instead.
 */
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false, // SSR / prerender: assume the narrow layout
  );
}

// Matches Tailwind's `lg` breakpoint — the width at which the rail appears.
export const DESKTOP_QUERY = "(min-width: 1024px)";
