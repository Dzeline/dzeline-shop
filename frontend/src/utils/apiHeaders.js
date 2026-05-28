const _key = import.meta.env.VITE_API_KEY ?? "";

export function apiHeaders(extra = {}) {
  return { "Content-Type": "application/json", "X-API-Key": _key, ...extra };
}

export function apiGetHeaders(extra = {}) {
  return { "X-API-Key": _key, ...extra };
}
