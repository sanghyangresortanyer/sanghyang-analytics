"""Pengaman tulis basis data untuk skrip Python, dengan aturan yang sama seperti lib/db.ts.

Dari mesin kerja, tulis ke basis data di luar mesin ini ditolak kecuali ALLOW_PRODUCTION_WRITE=1. Runtime Vercel
(VERCEL=1) dan job CI (CI=true) memang menulis ke basis data produksinya, jadi tidak dicegah. Pengaman tidak bergantung
pada PRODUCTION_DATABASE_MARKER, karena .env.local (produksi) tidak memuat penanda itu.
"""

import os
from urllib.parse import urlsplit

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


class ProductionWriteBlockedError(Exception):
    """Galat ketika operasi tulis ke basis data jarak jauh diblokir."""


def _database_url(db_url: str | None = None) -> str:
    return (db_url or os.environ.get("DATABASE_URL") or os.environ.get("DIRECT_URL") or "").strip()


def is_remote_database(db_url: str | None = None) -> bool:
    url = _database_url(db_url)
    if not url:
        return False
    host = (urlsplit(url).hostname or "").lower()
    marker = os.environ.get("PRODUCTION_DATABASE_MARKER", "").strip().lower()
    return host not in LOOPBACK_HOSTS or bool(marker and marker in url.lower())


def verify_write_allowed(db_url: str | None = None) -> bool:
    """Lempar ProductionWriteBlockedError bila target jarak jauh tanpa izin eksplisit, Vercel, atau CI."""
    if not is_remote_database(db_url):
        return True
    if os.environ.get("ALLOW_PRODUCTION_WRITE") == "1" or os.environ.get("VERCEL") == "1" or os.environ.get("CI") == "true":
        return True
    raise ProductionWriteBlockedError(
        "Tulis ke basis data jarak jauh diblokir pengaman (set ALLOW_PRODUCTION_WRITE=1 bila memang disengaja)."
    )
