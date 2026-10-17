"""Royal Jarvis — Stomach. Digests external knowledge into memory."""
from __future__ import annotations
import json, sqlite3, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"D:\01_PROJECTS\AIOS")
MEM_DB = ROOT / "04_MEMORY" / "aios_memory" / "royal_memory.db"
OLLAMA_URL = "http://127.0.0.1:11434"
MODEL = "qwen2.5:3b"

def _now(): return datetime.now(timezone.utc).isoformat()
def _conn(): return sqlite3.connect(str(MEM_DB))

def _ensure_schema():
    with _conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS stomach_raw (
            id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, content TEXT,
            chars INTEGER, ingested_at TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS stomach_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, raw_id INTEGER, fact TEXT,
            category TEXT, confidence REAL, created_at TEXT)""")
        c.commit()

PROMPT = """You digest external knowledge into structured facts. Extract only what is actually in the text.
TEXT:
---
{content}
---
Return JSON ONLY:
{{"facts": [{{"fact": "atomic factual statement", "category": "tech|science|business|personal|general", "confidence": 0.8}}],
"hypotheses": [{{"hypothesis": "testable claim", "rationale": "why", "novelty": 0.8, "testability": 0.7}}],
"contradictions": ["any fact that contradicts common knowledge"]}}
"""

def _ollama_json(prompt, timeout=180):
    body = json.dumps({"model": MODEL, "prompt": prompt, "stream": False, "format": "json"}).encode()
    req = urllib.request.Request(OLLAMA_URL + "/api/generate", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode())
        return {"ok": True, "text": data.get("response", ""), "ms": int((time.time()-t0)*1000)}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def _extract_json(text):
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n"); text = "\n".join(lines[1:-1]) if len(lines) > 2 else text
    try: return json.loads(text)
    except Exception:
        s, e = text.find("{"), text.rfind("}")
        if s >= 0 and e > s:
            try: return json.loads(text[s:e+1])
            except: return None
    return None

def feed(source, content, auto_hypothesize=True):
    _ensure_schema()
    if not content or len(content) < 20:
        return {"ok": False, "error": "content too short"}
    with _conn() as c:
        cur = c.execute("INSERT INTO stomach_raw (source, content, chars, ingested_at) VALUES (?, ?, ?, ?)",
                        (source, content, len(content), _now()))
        raw_id = cur.lastrowid; c.commit()
    r = _ollama_json(PROMPT.format(content=content[:6000]))
    if not r.get("ok"): return {"ok": False, "error": r.get("error"), "raw_id": raw_id}
    parsed = _extract_json(r.get("text", ""))
    if not parsed: return {"ok": False, "error": "LLM bad JSON", "raw_id": raw_id}
    fs, hs = 0, 0
    with _conn() as c:
        for f in parsed.get("facts", []):
            t = (f.get("fact") or "").strip()
            if not t: continue
            c.execute("INSERT INTO stomach_facts (raw_id, fact, category, confidence, created_at) VALUES (?,?,?,?,?)",
                      (raw_id, t, f.get("category","general"), float(f.get("confidence",0.5)), _now()))
            fs += 1
        if auto_hypothesize:
            for h in parsed.get("hypotheses", []):
                hyp = (h.get("hypothesis") or "").strip()
                if not hyp: continue
                nov, test_ = float(h.get("novelty",0.5)), float(h.get("testability",0.5))
                try:
                    c.execute("""INSERT INTO discoveries (source, hypothesis, rationale, evidence, score, novelty, testability, created_at)
                                 VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(source, hypothesis) DO NOTHING""",
                              ("stomach:"+source, hyp, h.get("rationale",""), f"raw_id={raw_id}",
                               round((nov+test_)/2,3), nov, test_, _now()))
                    hs += 1
                except: pass
        c.commit()
    return {"ok": True, "raw_id": raw_id, "source": source, "facts_stored": fs,
            "hypotheses_stored": hs, "contradictions": parsed.get("contradictions", []),
            "model_ms": r.get("ms")}

def stats():
    _ensure_schema()
    with _conn() as c:
        raw = c.execute("SELECT COUNT(*) FROM stomach_raw").fetchone()[0]
        facts = c.execute("SELECT COUNT(*) FROM stomach_facts").fetchone()[0]
        by = c.execute("SELECT source, COUNT(*) FROM stomach_raw GROUP BY source").fetchall()
    return {"raw": raw, "facts": facts, "by_source": dict(by)}

def list_facts(limit=20):
    _ensure_schema()
    with _conn() as c:
        rows = c.execute("""SELECT f.id, f.fact, f.category, f.confidence, r.source, f.created_at
                            FROM stomach_facts f JOIN stomach_raw r ON f.raw_id = r.id
                            ORDER BY f.id DESC LIMIT ?""", (int(limit),)).fetchall()
    return [{"id":r[0], "fact":r[1], "category":r[2], "confidence":r[3], "source":r[4], "created_at":r[5]} for r in rows]
