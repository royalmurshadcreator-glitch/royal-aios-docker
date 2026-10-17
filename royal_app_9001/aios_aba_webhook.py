"""
AIOS ABA Webhook Receiver
Exposes /api/aba/webhook endpoint that ABA can POST to when payment completes.
Records payment â†’ updates invoices table â†’ marks order as paid.
"""
from __future__ import annotations
import json, sqlite3, logging
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException

ROOT = Path(r"D:\01_PROJECTS\AIOS")
DB   = ROOT / "04_MEMORY" / "aios_memory" / "royal_memory.db"
LOG  = ROOT / "10_LOGS" / "aba"
LOG.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="AIOS ABA Webhook")

def now(): return datetime.now(timezone.utc).isoformat()

def log(msg: str):
    with (LOG / "webhook.log").open("a", encoding="utf-8") as f:
        f.write(f"[{now()}] {msg}\n")
    print(f"[ABA] {msg}", flush=True)

@app.post("/api/aba/webhook")
async def aba_webhook(request: Request):
    try:
        body = await request.body()
        data = json.loads(body.decode("utf-8", errors="ignore"))
    except Exception as e:
        log(f"parse error: {e}")
        raise HTTPException(400, "invalid json")

    log(f"received: {json.dumps(data)[:400]}")

    # Extract fields (ABA format varies â€” try common names)
    tran_id   = data.get("tran_id") or data.get("transaction_id") or data.get("order_id")
    amount    = data.get("amount") or data.get("total") or 0
    currency  = data.get("currency") or "USD"
    status    = data.get("status") or data.get("payment_status") or "unknown"
    order_uid = data.get("order_uid") or tran_id

    if not order_uid:
        log("no order_uid in payload")
        return {"ok": False, "error": "no order_uid"}

    try:
        c = sqlite3.connect(str(DB))
        cur = c.cursor()

        # Update invoice to paid
        cur.execute(
            "UPDATE invoices SET status='paid', paid_at=?, payment_link=? WHERE order_uid=?",
            (now(), json.dumps(data)[:500], order_uid)
        )
        updated = cur.rowcount

        # Record payment
        cur.execute(
            "INSERT INTO payments (order_uid, amount_usd, currency, method, raw_payload, received_at) "
            "VALUES (?, ?, ?, 'aba', ?, ?)",
            (order_uid, float(amount), currency, json.dumps(data)[:2000], now())
        )
        c.commit()
        c.close()
        log(f"order {order_uid} marked paid, {updated} invoice rows updated")
        return {"ok": True, "order_uid": order_uid, "amount": amount}
    except Exception as e:
        log(f"db error: {e}")
        raise HTTPException(500, str(e))

@app.get("/api/aba/health")
def health():
    return {"ok": True, "service": "aba_webhook", "listening": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=9001)