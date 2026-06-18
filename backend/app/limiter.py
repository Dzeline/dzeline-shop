from fastapi import Request
from slowapi import Limiter


def _client_ip(request: Request) -> str:
    # Behind Render's reverse proxy the real IP is in X-Forwarded-For.
    # Fall back to request.client.host for direct connections (local dev).
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host


limiter = Limiter(key_func=_client_ip)
