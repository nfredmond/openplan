"""Request headers for a Supabase service key, legacy JWT or secret key.

Supabase secret keys (``sb_secret_...``) are short strings, not JWTs, and
belong only on the ``apikey`` header. A legacy ``service_role`` key is a JWT and
keeps both headers exactly as before. The ActivitySim worker imports this module
from this directory, as it already does for the shared receipt checks.
"""
from __future__ import annotations

import re

# Three base64url segments, the first an encoded JSON object ("{" -> "eyJ").
_LEGACY_JWT = re.compile(r"eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


def is_legacy_jwt_key(key: object) -> bool:
    """True only for a whole three-part JWT, the legacy service_role key shape."""
    return isinstance(key, str) and _LEGACY_JWT.fullmatch(key) is not None


def service_key_headers(key: str) -> dict[str, str]:
    """``apikey`` always; ``Authorization: Bearer`` only for a legacy JWT key."""
    headers = {"apikey": key}
    if is_legacy_jwt_key(key):
        headers["Authorization"] = "Bearer " + key
    return headers
