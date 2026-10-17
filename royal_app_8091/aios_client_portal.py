"""
AIOS Client Portal â€” standalone FastAPI service on port 8091.
Clients log in with email + any of their order UIDs.
See orders, download deliverables, pay via ABA/Wing.
"""
from __future__ import annotations
import sqlite3, secrets, time, os, json
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header, Form
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get("AIOS_DB_PATH", "/tmp/royal_memory.db"))
CATALOG_SEED = ROOT / "catalog_seed.json"

def _initialize_database():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB))
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_catalog (
                app_slug TEXT PRIMARY KEY,
                app_name TEXT,
                category TEXT,
                description TEXT DEFAULT '',
                price_usd REAL DEFAULT 0,
                price_tier TEXT DEFAULT '',
                owner_division TEXT DEFAULT '',
                status TEXT
            )
        """)
        existing = {r[1] for r in conn.execute("PRAGMA table_info(app_catalog)")}
        for name, kind in (
            ("description", "TEXT DEFAULT ''"),
            ("price_tier", "TEXT DEFAULT ''"),
            ("owner_division", "TEXT DEFAULT ''")
        ):
            if name not in existing:
                conn.execute(f"ALTER TABLE app_catalog ADD COLUMN {name} {kind}")

        count = conn.execute("SELECT COUNT(*) FROM app_catalog").fetchone()[0]
        if count == 0 and CATALOG_SEED.exists():
            entries = json.loads(CATALOG_SEED.read_text(encoding="utf-8"))
            conn.executemany("""
                INSERT OR IGNORE INTO app_catalog
                (app_slug, app_name, category, description, price_usd,
                 price_tier, owner_division, status)
                VALUES
                (:app_slug, :app_name, :category, :description, :price_usd,
                 :price_tier, :owner_division, :status)
            """, entries)
        conn.commit()
    finally:
        conn.close()

_initialize_database()

app = FastAPI(title="AIOS Client Portal")

# In-memory tokens: token -> {email, issued}
TOKENS: dict[str, dict] = {}
TOKEN_TTL = 86400 * 7  # 7 days

# Business data
BUSINESS = {
    "name":    "BUKHARI SYED TALHA",
    "email":   "royal.murshad.creator@gmail.com",
    "wa":      "+855 76 635 8048",
    "aba_usd": "012 598 578",
    "aba_khr": "012 598 577",
    "aba_pay": "https://pay.ababank.com/oRF8/69l3f101",
    "wing_usd":"101 371 373",
    "wing_khr":"104 754 717",
}

def _q(sql, args=()):
    conn = sqlite3.connect(str(DB))
    conn.row_factory = sqlite3.Row
    try:
        c = conn.cursor()
        c.execute(sql, args)
        return [dict(r) for r in c.fetchall()]
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            raise HTTPException(
                503,
                "Customer order storage is not configured on this deployment."
            ) from exc
        raise
    finally:
        conn.close()

# ============================================================
# HTML pages
# ============================================================
LOGIN_HTML = """<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIOS Client Portal</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#141414;border:1px solid #262626;border-radius:16px;padding:32px;max-width:420px;width:100%}
h1{font-size:24px;margin-bottom:8px;color:#fff}
p.sub{color:#888;font-size:14px;margin-bottom:24px}
label{display:block;font-size:13px;color:#aaa;margin-bottom:6px;margin-top:14px}
input{width:100%;padding:12px;background:#0a0a0a;border:1px solid #262626;border-radius:8px;color:#fff;font-size:14px}
input:focus{outline:none;border-color:#10b981}
button{width:100%;margin-top:20px;padding:12px;background:#10b981;color:#000;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer}
button:hover{background:#0ea472}
.err{color:#ef4444;font-size:13px;margin-top:12px;display:none}
.err.show{display:block}
.brand{color:#10b981;font-weight:600;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
</style></head><body>
<div class="card">
  <div class="brand">AIOS Portal</div>
  <h1>Client Access</h1>
  <p class="sub">Enter the email you ordered with and any order ID we sent you.</p>
  <form id="f">
    <label>Email</label>
    <input id="email" type="email" required placeholder="you@example.com">
    <label>Order ID</label>
    <input id="order" type="text" required placeholder="ord_xxxxxxxxxxxx">
    <button type="submit">Sign In</button>
    <div class="err" id="err">Email and order ID don't match. Check your confirmation email.</div>
  </form>
</div>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await fetch('/api/portal/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email: document.getElementById('email').value, order: document.getElementById('order').value})
  });
  const d = await r.json();
  if (d.ok) { localStorage.setItem('tok', d.token); location.href = '/portal/dashboard'; }
  else { document.getElementById('err').classList.add('show'); }
});
</script></body></html>"""

def _html_dashboard() -> str:
    return """<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>My Orders</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh}
.wrap{max-width:720px;margin:0 auto;padding:24px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.brand{color:#10b981;font-weight:600;font-size:12px;letter-spacing:1px;text-transform:uppercase}
h1{font-size:22px;margin-bottom:4px;color:#fff}
.out{color:#888;font-size:13px;background:none;border:none;cursor:pointer}
.card{background:#141414;border:1px solid #262626;border-radius:12px;padding:20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.card:hover{border-color:#10b981}
.info{flex:1;min-width:0}
.uid{font-family:monospace;color:#888;font-size:12px;margin-bottom:4px}
.title{font-size:15px;color:#fff;margin-bottom:4px}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.b-delivered{background:#064e3b;color:#10b981}
.b-other{background:#1e3a8a;color:#60a5fa}
.btn{padding:10px 16px;background:#10b981;color:#000;border:none;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;text-decoration:none;white-space:nowrap}
.btn:hover{background:#0ea472}
.empty{text-align:center;padding:60px 20px;color:#666}
</style></head><body>
<div class="wrap">
  <div class="top">
    <div>
      <div class="brand">AIOS Portal</div>
      <h1>My Orders</h1>
    </div>
    <button class="out" onclick="out()">Sign out</button>
  </div>
  <div id="list"></div>
</div>
<script>
const tok = localStorage.getItem('tok');
if (!tok) location.href = '/portal/';
async function load() {
  const r = await fetch('/api/portal/orders', {headers:{'Authorization':'Bearer '+tok}});
  if (!r.ok) { out(); return; }
  const d = await r.json();
  const list = document.getElementById('list');
  if (!d.orders.length) { list.innerHTML = '<div class="empty">No orders yet.</div>'; return; }
  list.innerHTML = d.orders.map(o => `
    <div class="card">
      <div class="info">
        <div class="uid">${o.order_uid}</div>
        <div class="title">${o.product_type.replace(/_/g,' ')}</div>
        <span class="badge ${o.status==='delivered'?'b-delivered':'b-other'}">${o.status}</span>
      </div>
      <a class="btn" href="/portal/order/${o.order_uid}">View</a>
    </div>`).join('');
}
function out() { localStorage.removeItem('tok'); location.href = '/portal/'; }
load();
</script></body></html>"""

def _html_order(order: dict) -> str:
    import json
    uid = order["order_uid"]
    status_badge = "b-delivered" if order["status"] == "delivered" else "b-other"
    output_path = order.get("output_path") or ""
    download_btn = ""
    if output_path:
        download_btn = f'<a class="btn" href="/api/portal/download/{uid}">Download Deliverable</a>'
    preview = (order.get("output_preview") or "")[:500]
    return f"""<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order {uid}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh}}
.wrap{{max-width:720px;margin:0 auto;padding:24px}}
a.back{{color:#888;text-decoration:none;font-size:13px;display:inline-block;margin-bottom:16px}}
h1{{font-size:20px;color:#fff;margin-bottom:6px}}
.uid{{font-family:monospace;color:#888;font-size:12px;margin-bottom:16px}}
.badge{{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}}
.b-delivered{{background:#064e3b;color:#10b981}}
.b-other{{background:#1e3a8a;color:#60a5fa}}
.section{{background:#141414;border:1px solid #262626;border-radius:12px;padding:20px;margin-top:16px}}
.section h2{{font-size:14px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}}
.row{{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1a1a1a;font-size:14px}}
.row:last-child{{border:none}}
.row .k{{color:#888}}
.row .v{{color:#fff;font-family:monospace}}
.btn{{display:inline-block;padding:12px 20px;background:#10b981;color:#000;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;text-decoration:none;margin-top:12px}}
.btn:hover{{background:#0ea472}}
pre{{background:#0a0a0a;border:1px solid #1a1a1a;border-radius:8px;padding:12px;font-size:12px;color:#aaa;overflow-x:auto;max-height:200px}}
</style></head><body>
<div class="wrap">
  <a class="back" href="/portal/dashboard">â† Back to orders</a>
  <h1>{order['product_type'].replace('_',' ').title()}</h1>
  <div class="uid">{uid}</div>
  <span class="badge {status_badge}">{order['status']}</span>

  <div class="section">
    <h2>Order Details</h2>
    <div class="row"><span class="k">Customer</span><span class="v">{order.get('customer_name') or '-'}</span></div>
    <div class="row"><span class="k">Platform</span><span class="v">{order.get('platform') or '-'}</span></div>
    <div class="row"><span class="k">Created</span><span class="v">{str(order.get('created_at'))[:19]}</span></div>
  </div>

  <div class="section">
    <h2>Deliverable</h2>
    {f'<p style="color:#aaa;font-size:13px;margin-bottom:12px">Your deliverable is ready.</p>{download_btn}' if output_path else '<p style="color:#888;font-size:13px">Still being prepared. You\'ll get an email when ready.</p>'}
    {f'<pre>{preview}</pre>' if preview else ''}
  </div>

  <div class="section">
    <h2>Payment</h2>
    <div class="row"><span class="k">Amount</span><span class="v">${order.get('amount', 0):.2f} USD</span></div>
    <div class="row"><span class="k">ABA USD</span><span class="v">{BUSINESS['aba_usd']}</span></div>
    <div class="row"><span class="k">ABA KHR</span><span class="v">{BUSINESS['aba_khr']}</span></div>
    <div class="row"><span class="k">Wing USD</span><span class="v">{BUSINESS['wing_usd']}</span></div>
    <div class="row"><span class="k">Wing KHR</span><span class="v">{BUSINESS['wing_khr']}</span></div>
    <div class="row"><span class="k">Holder</span><span class="v">{BUSINESS['name']}</span></div>
    <a class="btn" href="{BUSINESS['aba_pay']}" target="_blank">Pay via ABA</a>
  </div>

  <div class="section">
    <h2>Support</h2>
    <div class="row"><span class="k">WhatsApp</span><span class="v">{BUSINESS['wa']}</span></div>
    <div class="row"><span class="k">Email</span><span class="v">{BUSINESS['email']}</span></div>
  </div>
</div></body></html>"""

# ============================================================
# Endpoints
# ============================================================
@app.get("/portal/", response_class=HTMLResponse)
def login_page(): return LOGIN_HTML

@app.get("/portal/dashboard", response_class=HTMLResponse)
def dashboard_page(): return _html_dashboard()

@app.get("/portal/order/{uid}", response_class=HTMLResponse)
def order_page(uid: str, authorization: str = Header(None)):
    # Allow direct URL with token in header OR fallback
    tok = (authorization or "").replace("Bearer ","").strip()
    if not tok or tok not in TOKENS:
        return HTMLResponse("<script>location.href='/portal/'</script>")
    rows = _q("SELECT * FROM orders WHERE order_uid=?", (uid,))
    if not rows: return HTMLResponse("<p>Order not found</p>", status_code=404)
    o = rows[0]
    inv = _q("SELECT amount_usd FROM invoices WHERE order_uid=?", (uid,))
    o["amount"] = inv[0]["amount_usd"] if inv else 0.0
    return _html_order(o)

@app.post("/api/portal/login")
async def portal_login(payload: dict):
    email = (payload.get("email") or "").strip().lower()
    order = (payload.get("order") or "").strip()
    if not email or not order: raise HTTPException(400, "missing fields")
    rows = _q("SELECT customer_email FROM orders WHERE order_uid=?", (order,))
    if not rows: raise HTTPException(401, "invalid")
    if (rows[0]["customer_email"] or "").lower() != email:
        raise HTTPException(401, "invalid")
    tok = secrets.token_urlsafe(32)
    TOKENS[tok] = {"email": email, "issued": time.time()}
    return {"ok": True, "token": tok}

@app.get("/api/portal/orders")
def portal_orders(authorization: str = Header(None)):
    tok = (authorization or "").replace("Bearer ","").strip()
    if not tok or tok not in TOKENS: raise HTTPException(401, "invalid")
    email = TOKENS[tok]["email"]
    rows = _q("SELECT order_uid, product_type, status, created_at FROM orders WHERE lower(customer_email)=? ORDER BY id DESC", (email,))
    return {"ok": True, "orders": rows}

@app.get("/api/portal/download/{uid}")
def portal_download(uid: str, authorization: str = Header(None)):
    tok = (authorization or "").replace("Bearer ", "").strip()
    if not tok or tok not in TOKENS:
        raise HTTPException(401, "invalid")
    rows = _q(
        "SELECT output_path, customer_email FROM orders WHERE order_uid=?",
        (uid,)
    )
    if not rows or not rows[0]["output_path"]:
        raise HTTPException(404, "no deliverable")
    if (rows[0]["customer_email"] or "").strip().lower() != TOKENS[tok]["email"]:
        raise HTTPException(403, "forbidden")
    p = Path(rows[0]["output_path"])
    if not p.is_file():
        raise HTTPException(404, "file missing")
    return FileResponse(p, filename=p.name)

STORE_HTML = """<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AIOS Store</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh}
.wrap{max-width:1100px;margin:0 auto;padding:24px}
.brand{color:#10b981;font-weight:600;font-size:12px;letter-spacing:1.5px;text-transform:uppercase}
h1{font-size:28px;color:#fff;margin:8px 0 4px}
.sub{color:#888;font-size:14px;margin-bottom:24px}
.stats{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}
.stat{background:#141414;border:1px solid #262626;border-radius:10px;padding:14px 18px;min-width:130px}
.stat .k{color:#666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
.stat .v{color:#10b981;font-size:20px;font-weight:700;margin-top:4px}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.filters button{background:#141414;border:1px solid #262626;color:#aaa;padding:6px 12px;border-radius:20px;font-size:12px;cursor:pointer}
.filters button:hover{border-color:#10b981;color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.card{background:#141414;border:1px solid #262626;border-radius:12px;padding:16px;display:flex;flex-direction:column}
.card:hover{border-color:#10b981;transform:translateY(-2px);transition:all 0.2s}
.cat{font-size:10px;color:#10b981;text-transform:uppercase;letter-spacing:0.5px}
.name{font-size:15px;color:#fff;margin:6px 0 4px;font-weight:600}
.desc{font-size:12px;color:#888;flex:1;margin-bottom:12px;line-height:1.4}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:auto}
.price{font-size:18px;color:#10b981;font-weight:700}
.buy{background:#10b981;color:#000;border:none;border-radius:8px;padding:8px 14px;font-weight:600;font-size:12px;cursor:pointer;text-decoration:none}
.buy:hover{background:#0ea472}
.tier{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.5px}
</style></head><body>
<div class="wrap">
  <div class="brand">AIOS Store</div>
  <h1>Production Apps by AIOS</h1>
  <p class="sub">52 working apps. Built in Cambodia. Ready to deploy.</p>
  <div class="stats" id="stats"></div>
  <div class="filters" id="filters"></div>
  <div class="grid" id="grid"></div>
</div>
<script>
async function load() {
  const r = await fetch('/api/store/catalog');
  const d = await r.json();
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="k">Apps</div><div class="v">${d.total}</div></div>
    <div class="stat"><div class="k">Categories</div><div class="v">${d.categories.length}</div></div>
    <div class="stat"><div class="k">Catalog Value</div><div class="v">$${Math.round(d.catalog_value)}</div></div>
  `;
  const cats = ['All', ...d.categories];
  document.getElementById('filters').innerHTML = cats.map(c => `<button onclick="filter('${c}')">${c}</button>`).join('');
  render(d.apps);
}
let ALL = [];
function render(apps) {
  document.getElementById('grid').innerHTML = apps.map(a => `
    <div class="card">
      <div class="cat">${a.category} Â· ${a.price_tier}</div>
      <div class="name">${a.app_name}</div>
      <div class="desc">${a.description}</div>
      <div class="foot">
        <div><div class="price">$${a.price_usd}</div><div class="tier">one-time</div></div>
        <a class="buy" href="mailto:royal.murshad.creator@gmail.com?subject=Purchase%20${a.app_slug}">Buy</a>
      </div>
    </div>
  `).join('');
}
async function filter(cat) {
  const r = await fetch('/api/store/catalog');
  const d = await r.json();
  if (cat === 'All') render(d.apps); else render(d.apps.filter(a => a.category === cat));
}
load();
</script></body></html>"""


@app.get("/store", response_class=HTMLResponse)
def store_page(): return STORE_HTML


@app.get("/api/store/catalog")
def store_catalog():
    conn = sqlite3.connect(str(DB)); conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT app_slug, app_name, category, description, price_usd, price_tier, owner_division FROM app_catalog WHERE status IN ('listed','ready') ORDER BY price_usd DESC")
    apps = [dict(r) for r in c.fetchall()]
    c.execute("SELECT DISTINCT category FROM app_catalog ORDER BY category")
    categories = [r[0] for r in c.fetchall()]
    c.execute("SELECT COUNT(*), COALESCE(SUM(price_usd),0) FROM app_catalog WHERE status IN ('listed','ready')")
    total, cat_val = c.fetchone()
    conn.close()
    return {"ok": True, "total": total, "catalog_value": float(cat_val),
            "categories": categories, "apps": apps}


@app.get("/api/portal/health")
def health(): return {"ok": True, "service": "aios_client_portal", "tokens": len(TOKENS)}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8091")),
        log_level="info"
    )