"""
ROYAL JARVIS - Local Auth (Phase 40)
Multi-user login. Stdlib-only: pbkdf2_hmac + secrets for tokens.
Tables: auth_users, auth_sessions (in royal_memory.db).
"""
import hashlib, hmac, os, secrets, sqlite3, time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"D:\01_PROJECTS\AIOS")
MEM_DB = ROOT / "04_MEMORY" / "aios_memory" / "royal_memory.db"

PBKDF2_ITERATIONS = 200_000
PBKDF2_ALGO = "sha256"
SESSION_TTL_SEC = 7 * 24 * 3600   # 7 days
COOKIE_NAME = "royal_session"


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _conn():
    c = sqlite3.connect(str(MEM_DB))
    c.row_factory = sqlite3.Row
    return c


def ensure_schema():
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS auth_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT,
                display_name TEXT,
                pw_hash TEXT NOT NULL,
                pw_salt TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                last_login TEXT
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                ip TEXT,
                user_agent TEXT
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_sess_user ON auth_sessions(username)")
        c.commit()


def _hash(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac(PBKDF2_ALGO, password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS)
    return dk.hex()


def _verify(password: str, salt: str, expected_hash: str) -> bool:
    calc = _hash(password, salt)
    return hmac.compare_digest(calc, expected_hash)


def _public(user_row) -> dict:
    return {
        "id": user_row["id"],
        "username": user_row["username"],
        "email": user_row["email"],
        "display_name": user_row["display_name"] or user_row["username"],
        "role": user_row["role"],
        "active": bool(user_row["active"]),
        "created_at": user_row["created_at"],
        "last_login": user_row["last_login"],
    }


def login(username: str, password: str, ip: str = None, user_agent: str = None) -> dict:
    ensure_schema()
    with _conn() as c:
        row = c.execute("SELECT * FROM auth_users WHERE username=?", (username,)).fetchone()
        if not row or not row["active"]:
            return {"ok": False, "error": "invalid_credentials"}
        if not _verify(password, row["pw_salt"], row["pw_hash"]):
            return {"ok": False, "error": "invalid_credentials"}
        token = secrets.token_urlsafe(32)
        expires = datetime.fromtimestamp(time.time() + SESSION_TTL_SEC, tz=timezone.utc).isoformat()
        c.execute(
            "INSERT INTO auth_sessions (token,username,created_at,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?)",
            (token, username, _now_iso(), expires, ip, (user_agent or "")[:200]),
        )
        c.execute("UPDATE auth_users SET last_login=? WHERE username=?", (_now_iso(), username))
        c.commit()
        return {"ok": True, "token": token, "expires_at": expires, "user": _public(row)}


def logout(token: str) -> dict:
    ensure_schema()
    with _conn() as c:
        c.execute("DELETE FROM auth_sessions WHERE token=?", (token,))
        c.commit()
    return {"ok": True}


def whoami(token: str) -> dict:
    ensure_schema()
    if not token:
        return {"ok": False, "error": "no_token"}
    with _conn() as c:
        s = c.execute("SELECT * FROM auth_sessions WHERE token=?", (token,)).fetchone()
        if not s:
            return {"ok": False, "error": "invalid_token"}
        if datetime.fromisoformat(s["expires_at"]) < datetime.now(timezone.utc):
            c.execute("DELETE FROM auth_sessions WHERE token=?", (token,))
            c.commit()
            return {"ok": False, "error": "expired"}
        u = c.execute("SELECT * FROM auth_users WHERE username=?", (s["username"],)).fetchone()
        if not u or not u["active"]:
            return {"ok": False, "error": "user_inactive"}
        return {"ok": True, "user": _public(u), "expires_at": s["expires_at"]}


def list_users() -> list:
    ensure_schema()
    with _conn() as c:
        rows = c.execute("SELECT * FROM auth_users ORDER BY id ASC").fetchall()
    return [_public(r) for r in rows]


def create_user(username: str, password: str, display_name=None, email=None, role="user") -> dict:
    ensure_schema()
    if not username or len(username) < 3:
        return {"ok": False, "error": "username_too_short"}
    if not password or len(password) < 14:
        return {"ok": False, "error": "password_too_short"}
    salt = secrets.token_hex(16)
    pw_hash = _hash(password, salt)
    try:
        with _conn() as c:
            c.execute(
                "INSERT INTO auth_users (username,email,display_name,pw_hash,pw_salt,role,active,created_at) "
                "VALUES (?,?,?,?,?,?,1,?)",
                (username, email, display_name or username, pw_hash, salt, role, _now_iso()),
            )
            c.commit()
        return {"ok": True, "username": username}
    except sqlite3.IntegrityError:
        return {"ok": False, "error": "username_exists"}


def delete_user(username: str) -> dict:
    ensure_schema()
    if username == "royal":
        return {"ok": False, "error": "cannot_delete_primary_admin"}
    with _conn() as c:
        c.execute("DELETE FROM auth_sessions WHERE username=?", (username,))
        r = c.execute("DELETE FROM auth_users WHERE username=?", (username,))
        c.commit()
    return {"ok": True, "deleted": r.rowcount}


def set_password(username: str, new_password: str) -> dict:
    ensure_schema()
    if not new_password or len(new_password) < 14:
        return {"ok": False, "error": "password_too_short"}
    salt = secrets.token_hex(16)
    pw_hash = _hash(new_password, salt)
    with _conn() as c:
        r = c.execute("UPDATE auth_users SET pw_hash=?, pw_salt=? WHERE username=?", (pw_hash, salt, username))
        c.execute("DELETE FROM auth_sessions WHERE username=?", (username,))
        c.commit()
    return {"ok": True, "updated": r.rowcount}



# ROYAL_OWNER_RECOVERY_PROFILE_V1
def update_profile(username: str, display_name=None, email=None) -> dict:
    ensure_schema()
    if not isinstance(display_name, str):
        return {"ok": False, "error": "invalid_display_name"}
    display_name = display_name.strip()
    if not display_name or len(display_name) > 100:
        return {"ok": False, "error": "invalid_display_name"}

    if email is not None:
        if not isinstance(email, str):
            return {"ok": False, "error": "invalid_email"}
        email = email.strip() or None
        if email is not None:
            if len(email) > 254 or "@" not in email or any(ch.isspace() for ch in email):
                return {"ok": False, "error": "invalid_email"}

    with _conn() as c:
        c.execute(
            "UPDATE auth_users SET display_name=?, email=? "
            "WHERE username=? AND active=1",
            (display_name, email, username),
        )
        row = c.execute(
            "SELECT * FROM auth_users WHERE username=? AND active=1",
            (username,),
        ).fetchone()
        if not row:
            return {"ok": False, "error": "user_not_found"}
        c.commit()
        return {"ok": True, "user": _public(row)}


def change_password_with_current(username: str, current_password: str,
                                 new_password: str) -> dict:
    ensure_schema()
    if not isinstance(new_password, str) or len(new_password) < 16:
        return {"ok": False, "error": "password_too_short"}
    if len(new_password.encode("utf-8")) > 1024:
        return {"ok": False, "error": "password_too_long"}
    if not isinstance(current_password, str) or not current_password:
        return {"ok": False, "error": "invalid_current_password"}

    with _conn() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute(
            "SELECT * FROM auth_users WHERE username=? AND active=1",
            (username,),
        ).fetchone()
        if not row or not _verify(
            current_password, row["pw_salt"], row["pw_hash"]
        ):
            c.rollback()
            return {"ok": False, "error": "invalid_current_password"}

        salt = secrets.token_hex(16)
        encoded = _hash(new_password, salt)
        c.execute(
            "UPDATE auth_users SET pw_hash=?, pw_salt=? WHERE username=?",
            (encoded, salt, username),
        )
        c.execute("DELETE FROM auth_sessions WHERE username=?", (username,))
        c.commit()

    return {"ok": True, "updated": 1, "sessions_invalidated": True}


def _ensure_recovery_schema(connection) -> None:
    connection.execute("""
        CREATE TABLE IF NOT EXISTS auth_recovery_tokens (
            token_hash TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT
        )
    """)
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_recovery_username "
        "ON auth_recovery_tokens(username)"
    )


def issue_local_recovery_token(username: str, ttl_minutes: int = 30) -> dict:
    # This is an internal function for a trusted local utility, not an HTTP route.
    ensure_schema()
    if not isinstance(ttl_minutes, int) or not 5 <= ttl_minutes <= 60:
        raise ValueError("invalid_recovery_ttl")

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    expires = datetime.fromtimestamp(
        now.timestamp() + ttl_minutes * 60, tz=timezone.utc
    ).isoformat()

    with _conn() as c:
        _ensure_recovery_schema(c)
        c.execute("BEGIN IMMEDIATE")
        user = c.execute(
            "SELECT username FROM auth_users "
            "WHERE username=? AND role='admin' AND active=1",
            (username,),
        ).fetchone()
        if not user:
            c.rollback()
            raise ValueError("active_admin_not_found")

        c.execute(
            "DELETE FROM auth_recovery_tokens WHERE username=?",
            (username,),
        )
        c.execute(
            "INSERT INTO auth_recovery_tokens "
            "(token_hash,username,created_at,expires_at,used_at) "
            "VALUES(?,?,?,?,NULL)",
            (token_hash, username, now.isoformat(), expires),
        )
        c.commit()

    return {
        "ok": True,
        "username": username,
        "recovery_code": token,
        "expires_at": expires,
    }


def reset_password_with_recovery(username: str, recovery_code: str,
                                  new_password: str) -> dict:
    ensure_schema()
    if not isinstance(new_password, str) or len(new_password) < 16:
        return {"ok": False, "error": "password_too_short"}
    if len(new_password.encode("utf-8")) > 1024:
        return {"ok": False, "error": "password_too_long"}
    if not isinstance(recovery_code, str) or not recovery_code or len(recovery_code) > 256:
        return {"ok": False, "error": "invalid_recovery_code"}
    if not isinstance(username, str) or not username.strip():
        return {"ok": False, "error": "invalid_recovery_code"}

    token_hash = hashlib.sha256(recovery_code.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    with _conn() as c:
        _ensure_recovery_schema(c)
        c.execute("BEGIN IMMEDIATE")
        recovery = c.execute(
            "SELECT token_hash,username,expires_at,used_at "
            "FROM auth_recovery_tokens WHERE token_hash=? AND username=?",
            (token_hash, username.strip()),
        ).fetchone()

        if not recovery or recovery["used_at"] is not None:
            c.rollback()
            return {"ok": False, "error": "invalid_recovery_code"}

        try:
            expires = datetime.fromisoformat(recovery["expires_at"])
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
        except Exception:
            c.rollback()
            return {"ok": False, "error": "invalid_recovery_code"}

        if expires <= now:
            c.execute(
                "UPDATE auth_recovery_tokens SET used_at=? WHERE token_hash=?",
                (now_iso, token_hash),
            )
            c.commit()
            return {"ok": False, "error": "expired_recovery_code"}

        user = c.execute(
            "SELECT username FROM auth_users "
            "WHERE username=? AND role='admin' AND active=1",
            (username.strip(),),
        ).fetchone()
        if not user:
            c.rollback()
            return {"ok": False, "error": "invalid_recovery_code"}

        salt = secrets.token_hex(16)
        encoded = _hash(new_password, salt)
        c.execute(
            "UPDATE auth_users SET pw_hash=?,pw_salt=? "
            "WHERE username=? AND role='admin' AND active=1",
            (encoded, salt, username.strip()),
        )
        if c.execute("SELECT changes()").fetchone()[0] != 1:
            c.rollback()
            return {"ok": False, "error": "invalid_recovery_code"}

        c.execute(
            "UPDATE auth_recovery_tokens SET used_at=? WHERE token_hash=?",
            (now_iso, token_hash),
        )
        c.execute(
            "DELETE FROM auth_sessions WHERE username=?",
            (username.strip(),),
        )
        c.commit()

    return {
        "ok": True,
        "password_reset": True,
        "sessions_invalidated": True,
    }

if __name__ == "__main__":
    ensure_schema()
    print("auth.py OK")
    print("users:", list_users())