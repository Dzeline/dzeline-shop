import { useState, useEffect } from "react";

/**
 * Installing the app to a desktop or phone.
 *
 * `beforeinstallprompt` fires **once**, early, and only when Chrome's own
 * engagement heuristics are satisfied — which is why the install banner seemed
 * to "take a while to show up". Nothing in the app was slow; it was waiting on
 * a browser event that may arrive late, or never.
 *
 * Two consequences this module handles:
 *
 * 1. The event is captured at module load and held, so a screen that mounts
 *    later (Settings) still has it. Listening inside a component means whoever
 *    mounts after the event fired gets nothing.
 * 2. Safari never fires it at all, so iPhone and iPad users could not install
 *    by any route the app offered. `installInstructions()` gives the manual
 *    steps for every platform, which is what makes installing reliable rather
 *    than a matter of luck.
 */

let deferredPrompt = null;
const listeners = new Set();

function notify() {
  for (const fn of listeners) fn(deferredPrompt);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  // Fired after a successful install by any route, including the browser's own
  // menu — the offer should disappear then, not linger.
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

/**
 * Manual steps for when there is no prompt to fire.
 *
 * Deliberately concrete — "use your browser menu" is not help when someone is
 * standing at a counter trying to get the till onto a laptop.
 */
export function installInstructions() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);

  if (isIOS) {
    return {
      platform: "iPhone / iPad",
      steps: [
        "Open this page in Safari (other browsers on iOS cannot install apps)",
        "Tap the Share button at the bottom of the screen",
        "Scroll down and tap “Add to Home Screen”",
        "Tap Add",
      ],
    };
  }
  if (isAndroid) {
    return {
      platform: "Android",
      steps: [
        "Open the browser menu (⋮, top right)",
        "Tap “Install app” or “Add to Home screen”",
        "Confirm Install",
      ],
    };
  }
  if (isFirefox) {
    return {
      platform: "Firefox",
      steps: [
        "Firefox on desktop cannot install web apps",
        "Open this page in Chrome or Edge to install it",
        "It still works normally in Firefox without installing",
      ],
    };
  }
  if (isSafari) {
    return {
      platform: "Safari on Mac",
      steps: ["Open the File menu", "Choose “Add to Dock”"],
    };
  }
  return {
    platform: "Chrome / Edge on desktop",
    steps: [
      "Look for the install icon (a screen with a downward arrow) at the right of the address bar",
      "Or open the browser menu (⋮) and choose “Install Dzeline Shop”",
      "Confirm Install",
    ],
  };
}

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(deferredPrompt);
  const [standalone] = useState(isStandalone);

  useEffect(() => {
    const fn = (p) => setPrompt(p);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  /**
   * Fire the native prompt. Resolves to true when the app was installed.
   *
   * The captured event is single-use: once prompted it cannot be reused, so it
   * is cleared either way and the caller falls back to the manual steps.
   */
  async function install() {
    if (!deferredPrompt) return false;
    const p = deferredPrompt;
    try {
      p.prompt();
      const choice = await p.userChoice;
      if (choice.outcome === "accepted") {
        deferredPrompt = null;
        notify();
        return true;
      }
      return false;
    } catch {
      // Chrome refuses a second prompt() on one event; the manual steps below
      // are the way back if this fails.
      return false;
    }
  }

  return {
    prompt,
    canInstall: Boolean(prompt),
    isStandalone: standalone,
    install,
    instructions: installInstructions(),
  };
}
