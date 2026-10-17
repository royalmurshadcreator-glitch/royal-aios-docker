"""
Dropship Ops â€” data providers for the dashboard.
Reads dropship/data/* and CJ wallet via API.
"""
from __future__ import annotations
import json, subprocess
from datetime import datetime, timezone
from pathlib import Path
import requests

DROPSHIP   = Path(r"D:\Everything\01_ROYAL_JARVIS\dropship")
ORDERS     = DROPSHIP / "data" / "orders"
PURCHASES  = DROPSHIP / "data" / "purchases"
TRACKING   = DROPSHIP / "data" / "tracking"
FINANCE    = DROPSHIP / "data" / "finance"
LISTINGS   = DROPSHIP / "data" / "active_listings"
STATE      = DROPSHIP / "data" / "scheduler_state.json"
VAULT      = Path(r"D:\Everything\01_ROYAL_JARVIS\03_MEMORY\data\keys.json")
PY         = Path(r"D:\Everything\01_ROYAL_JARVIS\.venv\Scripts\python.exe")
SCHED      = DROPSHIP / "scheduler_dropship.py"
POSTER     = DROPSHIP / "agents" / "listing" / "poster.py"

CJ_TOKEN_URL = "https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken"
CJ_BAL_URL   = "https://developers.cjdropshipping.com/api2.0/v1/shopping/pay/getBalance"


def _read_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _get_key(key_id: str):
    if not VAULT.exists():
        return None
    try:
        d = json.loads(VAULT.read_text(encoding="utf-8"))
        return (d.get("keys") or {}).get(key_id, {}).get("key")
    except Exception:
        return None


def list_orders():
    if not ORDERS.exists():
        return {"ok": True, "count": 0, "orders": []}
    out = []
    for f in sorted(ORDERS.glob("*.json")):
        d = _read_json(f)
        if not d:
            continue
        total = (d.get("pricingSummary") or {}).get("total") or {}
        out.append({
            "order_id": d.get("orderId") or f.stem,
            "created_at": d.get("creationDate"),
            "total": total.get("value"),
            "currency": total.get("currency"),
            "status": d.get("orderFulfillmentStatus"),
            "buyer": ((d.get("buyer") or {}).get("username")),
            "items": len(d.get("lineItems") or []),
        })
    return {"ok": True, "count": len(out), "orders": out}


def revenue_summary():
    s = _read_json(FINANCE / "summary.json")
    if not s:
        return {"ok": True, "revenue_total": 0, "profit_total": 0, "orders_total": 0,
                "orders_today": 0, "margin_pct": 0, "unfulfilled": 0,
                "generated_at": None}
    return {"ok": True, **s}


def agents_status():
    s = _read_json(STATE) or {}
    out = []
    for name, info in s.items():
        out.append({
            "name": name,
            "last_run": info.get("last_run_iso"),
            "ok": (info.get("last_result") or {}).get("ok"),
            "last_line": (info.get("last_result") or {}).get("last_line"),
        })
    return {"ok": True, "count": len(out), "agents": out}


def listings_live():
    if not LISTINGS.exists():
        return {"ok": True, "count": 0, "listings": []}
    out = []
    for f in sorted(LISTINGS.glob("*.json")):
        d = _read_json(f)
        if not d:
            continue
        ebay = d.get("ebay") or {}
        out.append({
            "sku": d.get("sku"),
            "name": d.get("name"),
            "price": d.get("price"),
            "ebay_item_id": ebay.get("item_id"),
            "posted_at": d.get("posted_at"),
            "ok": ebay.get("ok"),
        })
    return {"ok": True, "count": len(out), "listings": out}


def cj_balance():
    api_key = _get_key("cj.api_key")
    if not api_key:
        return {"ok": False, "error": "cj.api_key not set", "balance": None, "currency": None}
    try:
        r = requests.post(CJ_TOKEN_URL, json={"apiKey": api_key}, timeout=20)
        j = r.json()
        if not j.get("result"):
            return {"ok": False, "error": j.get("message", "auth failed"), "balance": None, "currency": None}
        token = j["data"]["accessToken"]
        r2 = requests.get(CJ_BAL_URL, headers={"CJ-Access-Token": token}, timeout=20)
        b = r2.json()
        data = b.get("data") or {}
        bal = data.get("amount") or data.get("balance") or data.get("availableAmount")
        return {"ok": True, "balance": bal, "currency": "USD", "raw": data}
    except Exception as e:
        return {"ok": False, "error": str(e), "balance": None, "currency": None}


def run_poster():
    try:
        r = subprocess.run([str(PY), str(POSTER), "--top", "5"], capture_output=True, text=True, timeout=600)
        return {"ok": r.returncode == 0, "output": (r.stdout or "").strip().splitlines()[-5:], "stderr": (r.stderr or "")[:300]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def run_scheduler_once():
    try:
        r = subprocess.run([str(PY), str(SCHED), "--once"], capture_output=True, text=True, timeout=900)
        return {"ok": r.returncode == 0, "output": (r.stdout or "").strip().splitlines()[-10:]}
    except Exception as e:
        return {"ok": False, "error": str(e)}