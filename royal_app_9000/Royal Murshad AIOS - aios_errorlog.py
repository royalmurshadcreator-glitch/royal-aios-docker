"""Royal Jarvis — Global Error Logger. Every subsystem can push errors here."""
from __future__ import annotations
import json, sqlite3, threading
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"D:\01_PROJECTS\AIOS")
DB = ROOT / "04_MEMORY" / "aios_memory" / "errorlog.db"
_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_schema():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(DB)) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS errors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            module TEXT NOT NULL,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            meta TEXT
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_ts ON errors(ts DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_module ON errors(module)")
        c.commit()


def log(module: str, level: str, message: str, meta: dict | None = None) -> dict:
    """Log an error. Thread-safe."""
    _ensure_schema()
    with _LOCK:
        with sqlite3.connect(str(DB)) as c:
            cur = c.execute(
                "INSERT INTO errors (ts, module, level, message, meta) VALUES (?, ?, ?, ?, ?)",
                (_now(), module, level, message, json.dumps(meta or {}))
            )
            c.commit()
            return {"ok": True, "id": cur.lastrowid}


def recent(limit: int = 50, module: str | None = None, level: str | None = None) -> list:
    _ensure_schema()
    q = "SELECT id, ts, module, level, message, meta FROM errors"
    cond = []
    args = []
    if module:
        cond.append("module = ?"); args.append(module)
    if level:
        cond.append("level = ?"); args.append(level)
    if cond:
        q += " WHERE " + " AND ".join(cond)
    q += " ORDER BY id DESC LIMIT ?"
    args.append(int(limit))
    with sqlite3.connect(str(DB)) as c:
        c.row_factory = sqlite3.Row
        rows = c.execute(q, args).fetchall()
    return [dict(r) for r in rows]


def stats() -> dict:
    _ensure_schema()
    with sqlite3.connect(str(DB)) as c:
        total = c.execute("SELECT COUNT(*) FROM errors").fetchone()[0]
        by_level = dict(c.execute("SELECT level, COUNT(*) FROM errors GROUP BY level").fetchall())
        by_module = dict(c.execute("SELECT module, COUNT(*) FROM errors GROUP BY module ORDER BY COUNT(*) DESC LIMIT 20").fetchall())
    return {"ok": True, "total": total, "by_level": by_level, "by_module": by_module, "db": str(DB)}


def purge_old(days: int = 30) -> dict:
    """Delete errors older than N days."""
    _ensure_schema()
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    with sqlite3.connect(str(DB)) as c:
        n = c.execute("DELETE FROM errors WHERE ts < ?", (cutoff,)).rowcount
        c.commit()
    return {"ok": True, "deleted": n}
