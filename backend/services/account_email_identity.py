"""One local account identity for a normalized email, across sign-in methods."""
from contextlib import contextmanager

from backend.database import get_conn


def normalize_email(value: str) -> str:
    return str(value or '').strip().lower()


def find_email_user(conn, email: str):
    address = normalize_email(email)
    if not address:
        return None
    rows = conn.execute('SELECT * FROM users WHERE lower(trim(email)) = ? LIMIT 2', (address,)).fetchall()
    if len(rows) > 1:
        raise ValueError('Multiple accounts use this email. Contact support to resolve them.')
    return rows[0] if rows else None


@contextmanager
def email_identity_transaction():
    conn = get_conn()
    try:
        conn.execute('BEGIN IMMEDIATE')
        with conn:
            yield conn
    finally:
        conn.close()
