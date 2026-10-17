"""
AIOS Arena Panel â€” live view at http://127.0.0.1:8092
"""
from __future__ import annotations
import sqlite3, json
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

DB = Path(r"D:\01_PROJECTS\AIOS\04_MEMORY\aios_memory\royal_memory.db")
app = FastAPI(title="AIOS Arena Panel")

HTML = """<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIOS Arena</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5}
.wrap{max-width:1100px;margin:0 auto;padding:24px}
h1{color:#fff;font-size:24px;margin-bottom:6px}
.sub{color:#888;font-size:14px;margin-bottom:24px}
.stats{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px}
.stat{background:#141414;border:1px solid #262626;border-radius:10px;padding:14px 18px;min-width:140px}
.stat .k{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
.stat .v{color:#10b981;font-size:22px;font-weight:700;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#141414;border-radius:12px;overflow:hidden;margin-bottom:24px}
th,td{padding:12px 14px;text-align:left;font-size:13px;border-bottom:1px solid #1a1a1a}
th{background:#0a0a0a;color:#888;text-transform:uppercase;font-size:11px;letter-spacing:0.5px}
tr:hover{background:#1a1a1a}
.tag{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.finished{background:#064e3b;color:#10b981}
.running{background:#1e3a8a;color:#60a5fa}
.cheat{background:#7f1d1d;color:#fca5a5}
.btn{padding:10px 16px;background:#10b981;color:#000;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;margin-right:8px}
.btn:hover{background:#0ea472}
</style></head><body>
<div class="wrap">
  <h1>AIOS Behavior Arena</h1>
  <p class="sub">Agents compete. Behavior logged. Cheats flagged.</p>
  <div class="stats" id="stats"></div>
  <div>
    <button class="btn" onclick="fireMatch()">Run 1 Match Now</button>
    <button class="btn" onclick="location.reload()">Refresh</button>
  </div>
  <br>
  <table>
    <thead><tr><th>Match</th><th>Scenario</th><th>Agents</th><th>Status</th><th>Winner</th><th>Duration</th><th>When</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</div>
<script>
async function load() {
  const r = await fetch('/api/matches');
  const d = await r.json();
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="k">Matches</div><div class="v">${d.total}</div></div>
    <div class="stat"><div class="k">Finished</div><div class="v">${d.finished}</div></div>
    <div class="stat"><div class="k">Cheats Flagged</div><div class="v">${d.cheats}</div></div>
    <div class="stat"><div class="k">Total Turns</div><div class="v">${d.turns}</div></div>
  `;
  document.getElementById('rows').innerHTML = d.matches.map(m => `
    <tr>
      <td><code>${m.match_id}</code></td>
      <td>${m.scenario}</td>
      <td>${JSON.parse(m.agents).length} agents</td>
      <td><span class="tag ${m.status}">${m.status}</span></td>
      <td>${m.winner || '-'}</td>
      <td>${m.duration_s || 0}s</td>
      <td>${(m.started_at||'').slice(0,16)}</td>
    </tr>
  `).join('');
}
async function fireMatch() {
  const r = await fetch('/api/run', {method:'POST'});
  const d = await r.json();
  alert('Match queued: ' + (d.match_id || 'error'));
  setTimeout(load, 3000);
}
load();
setInterval(load, 8000);
</script></body></html>"""

@app.get("/arena", response_class=HTMLResponse)
def arena_page(): return HTML

@app.get("/api/matches")
def matches():
    conn = sqlite3.connect(str(DB)); conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT match_id, scenario, agents, status, winner, duration_s, started_at, cheat_flags FROM arena_matches ORDER BY id DESC LIMIT 50")
    rows = [dict(r) for r in c.fetchall()]
    c.execute("SELECT COUNT(*) FROM arena_matches"); total = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM arena_matches WHERE status='finished'"); finished = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM arena_turns"); turns = c.fetchone()[0]
    cheats = 0
    for r in rows:
        try:
            cf = json.loads(r.get("cheat_flags") or "{}")
            cheats += sum(1 for v in cf.values() if v)
        except Exception:
            pass
    conn.close()
    return {"ok": True, "total": total, "finished": finished,
            "turns": turns, "cheats": cheats, "matches": rows}

@app.post("/api/run")
def run_now():
    import subprocess, uuid, sys
    mid = "m_" + uuid.uuid4().hex[:10]
    # fire in background so panel doesn't block
    subprocess.Popen([
        str(Path(r"D:\01_PROJECTS\AIOS\18_ENV\.venv\Scripts\python.exe")),
        str(Path(r"D:\01_PROJECTS\AIOS\06_TOOLS\aios_leads\aios_arena.py")),
        "run", "--agents", "ASG-TECH-001,ASG-CAP-003",
        "--scenario", "resource"
    ])
    return {"ok": True, "match_id": mid, "note": "queued in background"}

@app.get("/api/health")
def health(): return {"ok": True, "service": "aios_arena_panel"}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8092, log_level='info')