"""Auto-generated: Royal AIOS Apps Registry API.
BOM-tolerant, missing-file-tolerant.
"""
from __future__ import annotations
import json, sqlite3, os, time
from pathlib import Path
from fastapi import APIRouter, HTTPException, Body

ROOT     = Path(r"D:\01_PROJECTS\AIOS")
REGISTRY = ROOT / "11_DATA" / "aios_app_registry.json"
DB_PATH  = ROOT / "11_DATA" / "aios_apps.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/api", tags=["apps-registry"])

def _load_registry() -> dict:
    if not REGISTRY.exists():
        return {"apps": []}
    try:
        # utf-8-sig strips BOM automatically
        text = REGISTRY.read_text(encoding="utf-8-sig")
        return json.loads(text)
    except Exception as e:
        print(f"[registry] load error: {e}")
        return {"apps": []}

def _conn():
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    return c

def _ensure_table(table: str):
    # sanitize table name (only letters, digits, underscore)
    import re
    if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', table):
        raise HTTPException(400, f"invalid table name: {table}")
    c = _conn()
    c.execute(f"""CREATE TABLE IF NOT EXISTS {table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""")
    c.commit()
    c.close()

def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S")

def _find_app(slug: str):
    reg = _load_registry()
    for a in reg.get("apps", []):
        if a.get("slug") == slug:
            return a
    return None

@router.get("/registry/apps")
def list_registry_apps():
    reg = _load_registry()
    return {"ok": True, "count": len(reg.get("apps", [])), "apps": reg.get("apps", [])}

@router.get("/registry/apps/{slug}")
def get_registry_app(slug: str):
    app = _find_app(slug)
    if not app:
        raise HTTPException(404, f"app '{slug}' not found in registry")
    return {"ok": True, "app": app}

@router.get("/registry/health")
def registry_health():
    reg = _load_registry()
    return {
        "ok": True,
        "apps_registered": len(reg.get("apps", [])),
        "db_path": str(DB_PATH),
        "db_exists": DB_PATH.exists(),
        "version": reg.get("version")
    }

@router.get("/apps/summary")
def apps_summary():
    reg = _load_registry()
    out = []
    try:
        c = _conn()
        for a in reg.get("apps", []):
            _ensure_table(a["db_table"])
            n = c.execute(f"SELECT COUNT(*) FROM {a['db_table']}").fetchone()[0]
            out.append({"slug": a["slug"], "name": a["name"], "port": a["port"], "records": n})
        c.close()
    except Exception as e:
        print(f"[registry] summary error: {e}")
    return {"ok": True, "total_apps": len(out), "apps": out}

@router.get("/apps/{slug}/health")
def app_health(slug: str):
    app = _find_app(slug)
    if not app:
        raise HTTPException(404, f"app '{slug}' not found")
    _ensure_table(app["db_table"])
    c = _conn()
    n = c.execute(f"SELECT COUNT(*) FROM {app['db_table']}").fetchone()[0]
    c.close()
    return {"ok": True, "slug": slug, "table": app["db_table"], "records": n}

@router.get("/apps/{slug}/stats")
def app_stats(slug: str):
    app = _find_app(slug)
    if not app:
        raise HTTPException(404, f"app '{slug}' not found")
    _ensure_table(app["db_table"])
    c = _conn()
    n = c.execute(f"SELECT COUNT(*) FROM {app['db_table']}").fetchone()[0]
    latest = c.execute(f"SELECT updated_at FROM {app['db_table']} ORDER BY id DESC LIMIT 1").fetchone()
    c.close()
    return {"ok": True, "slug": slug, "total_records": n, "last_updated": latest[0] if latest else None}

@router.get("/apps/{slug}/records")
def list_records(slug: str, limit: int = 100, offset: int = 0):
    app = _find_app(slug)
    if not app:
        raise HTTPException(404, f"app '{slug}' not found")
    _ensure_table(app["db_table"])
    c = _conn()
    rows = c.execute(f"SELECT id, data, created_at, updated_at FROM {app['db_table']} ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    total = c.execute(f"SELECT COUNT(*) FROM {app['db_table']}").fetchone()[0]
    c.close()
    items = [{"id": r["id"], **json.loads(r["data"]), "_created": r["created_at"], "_updated": r["updated_at"]} for r in rows]
    return {"ok": True, "slug": slug, "total": total, "returned": len(items), "items": items}

@router.post("/apps/{slug}/records")
def create_record(slug: str, payload: dict = Body(...)):
    app = _find_app(slug)
    if not app:
        raise HTTPException(404, f"app '{slug}' not found")
    _ensure_table(app["db_table"])
    ts = _now()
    c = _conn()
    cur = c.execute(f"INSERT INTO {app['db_table']} (data, created_at, updated_at) VALUES (?,?,?)",
                    (json.dumps(payload), ts, ts))
    new_id = cur.lastrowid
    c.commit(); c.close()
    return {"ok": True, "id": new_id, "created_at": ts}

@router.get("/apps/{slug}/records/{rid}")
def get_record(slug: str, rid: int):
    app = _find_app(slug)
    if not app:
        raise HTTPException(404, f"app '{slug}' not found")
    _ensure_table(app["db_table"])
    c = _conn()
    r = c.execute(f"SELECT * FROM {app['db_table']} WHERE id=?", (rid,)).fetchone()
    c.close()
    if not r:
        raise HTTPException(404, "record not found")
    return {"ok": True, "id": r["id"], **json.loads(r["data"]), "_created": r["created_at"], "_updated": r["updated_at"]}

@router.put("/apps/{slug}/records/{rid}")
def update_record(slug: str, rid: int, payload: dict = Body(...)):
    app = _find_app(slug)
    if not app:
        raise HTTPException(404, f"app '{slug}' not found")
    _ensure_table(app["db_table"])
    ts = _now()
    c = _conn()
    r = c.execute(f"SELECT id FROM {app['db_table']} WHERE id=?", (rid,)).fetchone()
    if not r:
        c.close(); raise HTTPException(404, "record not found")
    c.execute(f"UPDATE {app['db_table']} SET data=?, updated_at=? WHERE id=?", (json.dumps(payload), ts, rid))
    c.commit(); c.close()
    return {"ok": True, "id": rid, "updated_at": ts}

@router.delete("/apps/{slug}/records/{rid}")
def delete_record(slug: str, rid: int):
    app = _find_app(slug)
    if not app:
        raise HTTPException(404, f"app '{slug}' not found")
    _ensure_table(app["db_table"])
    c = _conn()
    c.execute(f"DELETE FROM {app['db_table']} WHERE id=?", (rid,))
    c.commit(); c.close()
    return {"ok": True, "deleted": rid}