import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/ecosystem/apps", tags=["Royal Murshad Ecosystem"])

_ROOT = Path(r"D:\01_PROJECTS\AIOS")
_CONFIG = _ROOT / "config"
_STORE = _CONFIG / "ecosystem_apps_registry.json"
_FAMILIES = [
    "AI & Intelligence",
    "Business & Operations",
    "Creation & Media",
    "Developer Tools",
    "Knowledge & Memory",
    "Communication",
    "Security & Identity",
    "Commerce & Store",
    "Productivity",
    "Data & Analytics",
    "Devices & Automation",
    "Platform Services",
]


def _read_store():
    _CONFIG.mkdir(parents=True, exist_ok=True)
    if not _STORE.exists():
        return {"schema_version": 1, "families": _FAMILIES, "apps": []}
    try:
        data = json.loads(_STORE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="App registry file is unreadable") from exc
    if not isinstance(data, dict) or not isinstance(data.get("apps"), list):
        raise HTTPException(status_code=500, detail="App registry schema is invalid")
    return data


def _write_store(data):
    _CONFIG.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n",
            dir=str(_CONFIG), prefix="ecosystem_apps_", suffix=".tmp",
            delete=False
        ) as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            temp_path = handle.name
        os.replace(temp_path, _STORE)
    except OSError as exc:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail="Could not save app registry") from exc


@router.get("")
def list_registered_apps():
    data = _read_store()
    return {
        "ok": True,
        "items": data["apps"],
        "total": len(data["apps"]),
        "families": data.get("families", _FAMILIES),
    }


@router.post("")
async def register_app(request: Request):
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Expected a JSON request body") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    app_id = str(payload.get("id", "")).strip()
    name = str(payload.get("name", "")).strip()
    family = str(payload.get("family", "")).strip()
    description = str(payload.get("description", "")).strip()
    icon = str(payload.get("icon", "blocks")).strip() or "blocks"

    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{1,99}", app_id):
        raise HTTPException(status_code=422, detail="id must be 2-100 safe characters")
    if not name or len(name) > 120:
        raise HTTPException(status_code=422, detail="name is required and must be at most 120 characters")
    if family not in _FAMILIES:
        raise HTTPException(status_code=422, detail="family must match one of the 12 registered families")
    if len(description) > 1000 or len(icon) > 80:
        raise HTTPException(status_code=422, detail="description or icon is too long")

    data = _read_store()
    if any(str(item.get("id", "")).casefold() == app_id.casefold() for item in data["apps"]):
        raise HTTPException(status_code=409, detail="An app with this id is already registered")

    entry = {
        "id": app_id,
        "name": name,
        "family": family,
        "description": description,
        "icon": icon,
        "status": "registered",
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }
    data["schema_version"] = 1
    data["families"] = _FAMILIES
    data["apps"].append(entry)
    _write_store(data)
    return {"ok": True, "item": entry, "total": len(data["apps"])}
