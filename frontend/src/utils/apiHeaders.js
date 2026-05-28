// Runtime API key — set once on app startup from IndexedDB.
// Falls back to build-time VITE_API_KEY for local dev / single-tenant deploys.
let _key = import.meta.env.VITE_API_KEY ?? "";

export function setApiKey(key) {
  if (key) _key = key;
}

export function apiHeaders(extra = {}) {
  return { "Content-Type": "application/json", "X-API-Key": _key, ...extra };
}

export function apiGetHeaders(extra = {}) {
  return { "X-API-Key": _key, ...extra };
}
