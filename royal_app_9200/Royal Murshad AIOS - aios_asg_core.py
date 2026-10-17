"""
AL SYED GROUP (ASG) CORE
=========================
Central router for the 9 sub-companies.
- Loads asg_structure.json (120 employees)
- Classifies incoming intents using local Ollama (qwen2.5:3b)
- Dispatches to the correct sub-company
- Serves HTTP API on port 9200

Endpoints:
    GET  /api/asg/health
    GET  /api/asg/tree
    GET  /api/asg/overview
    POST /api/asg/route      {"text": "check my ebay orders"}
    GET  /api/asg/subsystems
    GET  /api/asg/logs
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
STRUCTURE_FILE = HERE / "aios_asg_structure.json"
LOGS = HERE / "logs"
LOGS.mkdir(parents=True, exist_ok=True)
ROUTING_LOG = LOGS / "routing.jsonl"

OLLAMA_URL = "http://127.0.0.1:11434"
ROUTER_MODEL = "qwen2.5:3b"

app = FastAPI(title="AL SYED GROUP (ASG) CORE", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

def _load_structure() -> dict:
    if not STRUCTURE_FILE.exists():
        return {"parent_company": "AL SYED GROUP (ASG)", "sub_companies": []}
    return json.loads(STRUCTURE_FILE.read_text(encoding="utf-8"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _log(entry: dict) -> None:
    entry["ts"] = _now()
    with ROUTING_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Intent classification via Ollama
# ---------------------------------------------------------------------------

ROUTING_HINTS = {
    "asg-tech":    "coding, saas, api, cloud, schema, documentation, devtools, security scanning of code, boilerplate, uptime, database",
    "asg-growth":  "marketing, seo, leads, cold email, outreach, backlinks, reputation, reviews, ads, campaigns",
    "asg-media":   "video, audio, content, podcast, translation, newsletter, ebook, comic, tts, subtitles, dubbing",
    "asg-commerce": "ebay, dropship, orders, products, listing, cj, tracking, purchase, price, inventory, fulfillment",
    "asg-capital": "crypto, stocks, forex, trading, real estate, market, arbitrage, financial, investment, signals",
    "asg-legal":   "legal, patent, trademark, compliance, contract, nda, regulatory, policy, clause",
    "asg-people":  "hiring, resume, hr, employee, onboarding, expense, shift, support, ticket, wiki",
    "asg-data":    "research, analytics, trends, news, competitor, sentiment, market intelligence, report",
    "asg-cyber":   "security audit, pentest, vulnerability, cve, threat, incident, hack, exploit, reverse engineering, siem",
}


def _classify(text: str) -> tuple[str, float, str]:
    """Use Ollama to pick a sub-company. Fall back to keyword matching."""
    hints = "\n".join("- {}: {}".format(k, v) for k, v in ROUTING_HINTS.items())
    prompt = (
        "You are a router for AL SYED GROUP. Choose ONE sub-company id for the user request.\n"
        "Sub-companies:\n" + hints + "\n"
        "Reply with ONLY the sub-company id (e.g. asg-commerce). No explanation.\n\n"
        "User request: " + text.strip() + "\n"
        "Sub-company id:"
    )
    try:
        r = requests.post(
            OLLAMA_URL + "/api/generate",
            json={
                "model": ROUTER_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.0, "num_predict": 12},
            },
            timeout=30,
        )
        r.raise_for_status()
        out = (r.json().get("response") or "").strip().lower()
        for token in out.replace(".", " ").replace(",", " ").split():
            if token.startswith("asg-"):
                if token in ROUTING_HINTS:
                    return token, 0.9, "ollama"
        # Fuzzy match
        for key in ROUTING_HINTS:
            if key in out:
                return key, 0.8, "ollama_fuzzy"
    except Exception as e:
        _log({"action": "ollama_error", "error": str(e)})

    # Keyword fallback
    low = text.lower()
    scores = {}
    for key, hint in ROUTING_HINTS.items():
        score = sum(1 for word in hint.split(", ") if word in low)
        scores[key] = score
    best = max(scores, key=scores.get)
    if scores[best] > 0:
        return best, 0.5, "keyword"
    return "asg-data", 0.1, "default"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class RouteReq(BaseModel):
    text: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/asg/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "AL SYED GROUP (ASG) CORE",
        "ts": _now(),
        "ollama": _ollama_alive(),
        "structure_loaded": STRUCTURE_FILE.exists(),
    }

@app.get("/api/asg/asg-core/health")
def health_alias() -> dict:
    return health()


def _ollama_alive() -> bool:
    try:
        r = requests.get(OLLAMA_URL + "/api/tags", timeout=3)
        return r.ok
    except Exception:
        return False


@app.get("/api/asg/tree")
def tree() -> dict:
    return _load_structure()


@app.get("/api/asg/overview")
def overview() -> dict:
    s = _load_structure()
    subs = s.get("sub_companies", [])
    total_emp = sum(len(sc.get("employees", [])) for sc in subs)
    active = sum(1 for sc in subs for e in sc.get("employees", []) if e.get("status") == "active")
    return {
        "ok": True,
        "parent_company": s.get("parent_company"),
        "ceo": s.get("founder_ceo"),
        "sub_companies": len(subs),
        "total_employees": total_emp,
        "active_employees": active,
        "live_companies": [sc["legal_name"] for sc in subs if sc.get("status") == "live"],
        "ts": _now(),
    }


@app.get("/api/asg/subsystems")
def subsystems() -> dict:
    s = _load_structure()
    out = []
    for sc in s.get("sub_companies", []):
        port = sc.get("port")
        alive = False
        try:
            r = requests.get("http://127.0.0.1:%d/api/asg/%s/health" % (port, sc["id"]), timeout=2)
            alive = r.ok
        except Exception:
            alive = False
        out.append({
            "id": sc["id"],
            "legal_name": sc["legal_name"],
            "port": port,
            "status": sc.get("status"),
            "alive": alive,
            "employee_count": len(sc.get("employees", [])),
        })
    return {"ok": True, "subsystems": out, "ts": _now()}


@app.post("/api/asg/route")
def route(req: RouteReq) -> dict:
    if not req.text.strip():
        raise HTTPException(400, "empty text")
    sub_id, conf, method = _classify(req.text)
    s = _load_structure()
    sub = next((sc for sc in s.get("sub_companies", []) if sc["id"] == sub_id), None)
    if not sub:
        sub = {"id": sub_id, "legal_name": sub_id, "port": None}
    result = {
        "ok": True,
        "input": req.text,
        "sub_company_id": sub_id,
        "sub_company_name": sub.get("legal_name"),
        "port": sub.get("port"),
        "confidence": conf,
        "method": method,
        "ts": _now(),
    }
    _log({"action": "route", **result})
    return result


@app.get("/api/asg/logs")
def logs(limit: int = 50) -> dict:
    if not ROUTING_LOG.exists():
        return {"ok": True, "count": 0, "logs": []}
    lines = ROUTING_LOG.read_text(encoding="utf-8").splitlines()[-limit:]
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return {"ok": True, "count": len(out), "logs": out}


if __name__ == "__main__":
    import uvicorn
    print("Starting AL SYED GROUP (ASG) CORE on port 9200")
    print("Structure:", STRUCTURE_FILE)
    print("Ollama:", OLLAMA_URL, "| Model:", ROUTER_MODEL)
    uvicorn.run(app, host="127.0.0.1", port=9200, log_level="info")