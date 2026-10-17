"""
Royal Jarvis ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Command Dispatcher v2
====================================
Now uses brain.understand() (LLM) as the PRIMARY intent parser.
Falls back to regex patterns if the LLM is unavailable or low-confidence.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Callable

# Import the brain
try:
    from brain import understand
except ImportError:
    understand = None

EXECUTOR_URL = "http://127.0.0.1:9000/api/executor/command"

# ----------------------------------------------------------------
# PENDING CLARIFICATION Ã¢â‚¬â€ remembers what Jarvis is waiting for
# ----------------------------------------------------------------
import time as _time

# --- Persona hook (RJ-11.5) ---
def _persona_reply(text: str) -> dict:
    """Send fallback chat through the persona + LLM so he speaks as Royal Jarvis."""
    try:
        import aios_persona as _persona
        import urllib.request as _ur, json as _js
        prompt = _persona.build_prompt(text)
        req = _ur.Request(
            "http://127.0.0.1:11434/api/generate",
            data=_js.dumps({
                "model": "qwen2.5:3b",
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.3, "num_predict": 120, "keep_alive": "30m"},
            }).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with _ur.urlopen(req, timeout=60) as r:
            raw = _js.loads(r.read().decode())["response"].strip()
        s, e = raw.find("{"), raw.rfind("}")
        if s >= 0 and e > s:
            parsed = _js.loads(raw[s:e+1])
            reply = (parsed.get("reply") or "").strip()
            if reply:
                return {"ok": True, "reply": reply, "detail": {"persona": True, "mode": parsed.get("mode", "chat")}}
    except Exception as _pe:
        pass
    return None
# --- end persona hook ---

_PENDING = {
    # {"app": "telegram", "missing": "Hamza",
    #  "candidates": ["Ali","Bilal",...], "asked_at": 1234567.89}
}


def _set_pending(app: str, missing: str, candidates: list) -> None:
    _PENDING.clear()
    _PENDING.update({
        "app": app,
        "missing": missing,
        "candidates": candidates,
        "asked_at": _time.time(),
    })


def _clear_pending() -> None:
    _PENDING.clear()


def _get_pending() -> dict:
    # expire after 90 seconds
    if _PENDING and (_time.time() - _PENDING.get("asked_at", 0)) > 90:
        _clear_pending()
    return dict(_PENDING)


def _post(action: str, **kwargs) -> dict:
    payload = {"action": action, "approve": True}
    payload.update({k: v for k, v in kwargs.items() if v is not None})
    req = urllib.request.Request(
        EXECUTOR_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ==== regex fallback (kept for when LLM is unavailable) ====

def _h_open_app(m: re.Match) -> dict:
    app = m.group(1).strip().lower()
    app = re.sub(r"^(the|a|an)\s+", "", app)
    return _post("open_app", app=app)

def _h_screenshot(_m: re.Match) -> dict:
    return _post("screenshot")

def _h_list_apps(_m: re.Match) -> dict:
    return _post("list_apps")

FALLBACK_RULES = [
    (re.compile(r"^(?:take\s+)?(?:a\s+)?screenshot\.?$", re.I), _h_screenshot),
    (re.compile(r"^(?:list|show)\s+(?:my\s+)?apps?\.?$", re.I), _h_list_apps),
    (re.compile(r"^(?:open|launch|start)\s+(.+?)\.?$", re.I), _h_open_app),
]


# ==== main dispatch ====

def dispatch(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        return {"ok": False, "reply": "I didn't hear anything.", "detail": None}

    # CHECK: are we waiting for the user to pick a candidate?
    pend = _get_pending()
    if pend:
        low = raw.lower()
        matched = None
        for c in pend.get("candidates", []):
            if c.lower() in low or low in c.lower():
                matched = c
                break
        if matched:
            _clear_pending()
            # resume the original workflow with the chosen name
            result = _call_messaging_agent(pend["app"], matched)
            return result
        # didn't match any candidate Ã¢â‚¬â€ clear and fall through
        # (so the user can say something completely different)
        _clear_pending()

    # TRY THE BRAIN FIRST
    if understand is not None:
        result = understand(raw)
        if result.get("error") is None and result.get("confidence", 0) >= 0.5:
            return _dispatch_from_intent(result, raw)

    # FALL BACK TO REGEX
    low = raw.lower().strip(".,!? ")
    for pattern, handler in FALLBACK_RULES:
        m = pattern.match(low)
        if m:
            try:
                r = handler(m)
            except Exception as e:
                return {"ok": False, "reply": f"Dispatch failed: {e}", "detail": None}
            return _reply_for(r, low)

    _p = _persona_reply(raw)
    if _p: return _p
    return {"ok": False, "reply": f"Sorry Boss, I don't know how to do: {raw}. Maybe you didn't tell me this.", "detail": None}


def _dispatch_from_intent(result: dict, original: str) -> dict:
    intent = result.get("intent", "unknown")
    app = (result.get("app") or "").strip().lower()
    conf = result.get("confidence", 0)

    if intent == "greeting":
        _p = _persona_reply(original)
        if _p: return {**_p, "detail": result}
        return {"ok": True, "reply": "Hello Boss. How can I help?", "detail": result}
    if intent == "meta":
        return {"ok": True,
                "reply": "I can open apps, take a screenshot, and list apps. Just say what you want.",
                "detail": result}
    if intent == "stop":
        return {"ok": True, "reply": "__STOP__", "detail": result}
    if intent == "time":
        import datetime as _dt
        _t = _dt.datetime.now().strftime("%I:%M %p").lstrip("0")
        return {"ok": True, "reply": f"It is {_t}.", "intent": "time", "detail": result}
    if intent == "date":
        import datetime as _dt
        _d = _dt.datetime.now().strftime("%A, %B %d")
        return {"ok": True, "reply": f"Today is {_d}.", "intent": "date", "detail": result}
    if intent == "volume_up":
        import subprocess as _sp
        for _ in range(5):
            _sp.run(["powershell","-c","(new-object -com wscript.shell).SendKeys([char]175)"],
                    capture_output=True, timeout=10)
        return {"ok": True, "reply": "Volume up.", "intent": "volume_up", "detail": result}
    if intent == "volume_down":
        import subprocess as _sp
        for _ in range(5):
            _sp.run(["powershell","-c","(new-object -com wscript.shell).SendKeys([char]174)"],
                    capture_output=True, timeout=10)
        return {"ok": True, "reply": "Volume down.", "intent": "volume_down", "detail": result}
    if intent == "mute":
        import subprocess as _sp
        _sp.run(["powershell","-c","(new-object -com wscript.shell).SendKeys([char]173)"],
                capture_output=True, timeout=10)
        return {"ok": True, "reply": "Muted.", "intent": "mute", "detail": result}
    if intent == "screenshot":
        r = _post("screenshot")
        return _reply_for(r, original)
    if intent == "list_apps":
        r = _post("list_apps")
        return _reply_for(r, original)
    if intent == "open_app":
        if not app:
            return {"ok": False, "reply": "I heard 'open' but couldn't tell which app.", "detail": result}
        r = _post("open_app", app=app)
        return _reply_for(r, original)

    if intent == "check_messages":
        # extract app + who from result (from brain)
        app = (result.get("app") or "").strip()
        who = (result.get("who") or result.get("text") or "").strip()
        if not app or not who:
            return {"ok": False,
                    "reply": "I need the app and the person's name. Try: check telegram from Alice.",
                    "detail": result}
        import subprocess as _sp
        from pathlib import Path as _P
        agent = _P(r"D:\01_ROYAL_JARVIS\Workspace\voice\messaging_agent.py")
        pyexe = _P(r"D:\01_ROYAL_JARVIS\.venv\Scripts\python.exe")
        try:
            r = _sp.run([str(pyexe), str(agent), "check", app, who],
                        capture_output=True, text=True, timeout=60)
            data = {}
            out = (r.stdout or "").strip()
            s = out.find("{")
            if s >= 0:
                import json as _j
                data = _j.loads(out[s:])
        except Exception as e:
            return {"ok": False, "reply": f"Messaging agent failed: {e}", "detail": result}

        if not data.get("ok"):
            return {"ok": False,
                    "reply": f"I couldn't read {app}. {data.get('error','')[:80]}",
                    "detail": result}

        last = data.get("last_message", "")
        reply = data.get("suggested_reply", "")
        spoken = (
            f"Last message from {who} on {app} says: {last}. "
            f"Suggested reply: {reply}. Should I send it, or say something else?"
        )
        return {"ok": True, "reply": spoken,
                "pending_send": {"who": who, "suggested": reply},
                "detail": result}

    if intent == "send_reply":
        text = (result.get("text") or "").strip()
        if not text:
            return {"ok": False, "reply": "What should I send?", "detail": result}
        import subprocess as _sp
        from pathlib import Path as _P
        agent = _P(r"D:\01_ROYAL_JARVIS\Workspace\voice\messaging_agent.py")
        pyexe = _P(r"D:\01_ROYAL_JARVIS\.venv\Scripts\python.exe")
        try:
            r = _sp.run([str(pyexe), str(agent), "send", text],
                        capture_output=True, text=True, timeout=20)
        except Exception as e:
            return {"ok": False, "reply": f"Send failed: {e}", "detail": result}
        return {"ok": True, "reply": f"Sent: {text}", "detail": result}
    if intent == "read_screen":
        r = _post("cu_read_screen")
        return _reply_for(r, original)

    if intent == "find_on_screen":
        text = (result.get("text") or "").strip()
        if not text:
            return {"ok": False, "reply": "I heard find but didn't get what to find.", "detail": result}
        r = _post("cu_find_text", text=text)
        return _reply_for(r, original)

    if intent == "click_on_screen":
        text = (result.get("text") or "").strip()
        if not text:
            return {"ok": False, "reply": "I heard click but didn't get what to click.", "detail": result}
        r = _post("cu_click_text", text=text)
        return _reply_for(r, original)

    if intent == "type_text":
        text = (result.get("text") or "").strip()
        if not text:
            return {"ok": False, "reply": "I heard type but didn't get what to type.", "detail": result}
        r = _post("cu_type_kb", text=text)
        return _reply_for(r, original)

    if intent == "press_key":
        key = (result.get("key") or "").strip()
        if not key:
            return {"ok": False, "reply": "I heard press but didn't get which key.", "detail": result}
        r = _post("cu_press_key", key=key)
        return _reply_for(r, original)

    return {"ok": False,
            "reply": "Sorry Boss, you didn't tell me this. Maybe you forgot to mention.",
            "detail": result}


def _reply_for(result: dict, original: str) -> dict:
    """Build the human-facing reply. Returns REAL content, not counts."""
    if result.get("ok"):
        action = result.get("action", "")

        if action == "open_app":
            target = result.get("target", "").replace(".exe", "")
            pretty = target.replace("calc", "Calculator").replace("code", "VS Code")
            return {"ok": True, "reply": f"Opening {pretty}.", "detail": result}

        if action == "close_app":
            target = result.get("target", "").replace(".exe", "")
            return {"ok": True, "reply": f"Closing {target}.", "detail": result}

        if action == "screenshot":
            return {"ok": True, "reply": "Screenshot saved.", "detail": result}

        if action == "list_apps":
            apps = result.get("apps", [])
            if not apps:
                return {"ok": True, "reply": "I couldn't find any apps.", "detail": result}
            names = []
            for a in apps:
                if isinstance(a, dict):
                    names.append(a.get("name", a.get("key", "?")))
                else:
                    names.append(str(a).replace(".exe", "").title())
            spoken = ", ".join(names[:25])
            more = f" and {len(names)-25} more" if len(names) > 25 else ""
            return {"ok": True,
                    "reply": f"You have {len(names)} apps. Here are the first ones: {spoken}{more}.",
                    "detail": result,
                    "apps": names}

        if action in ("cu_read_screen", "read_screen"):
            text = (result.get("text") or "").strip()
            chars = result.get("chars", 0)
            if not text:
                return {"ok": True, "reply": "The screen appears to be blank.", "detail": result}
            clean = " ".join(text.split())
            snippet = clean[:400]
            return {"ok": True,
                    "reply": f"I see on your screen: {snippet}",
                    "detail": result,
                    "screen_text": clean}

        if action == "cu_find_text":
            found = result.get("found") or ""
            ok = result.get("ok", False)
            if ok:
                return {"ok": True, "reply": f"Found '{found}' on screen.", "detail": result}
            return {"ok": False, "reply": f"I couldn't find '{found}' on your screen.", "detail": result}

        if action == "cu_click_text":
            target = result.get("target", "target")
            return {"ok": True, "reply": f"Clicked on {target}.", "detail": result}

        if action == "cu_type_kb":
            chars = result.get("chars", 0)
            return {"ok": True, "reply": f"Typed {chars} characters.", "detail": result}

        if action == "cu_press_key":
            key = result.get("key", "")
            return {"ok": True, "reply": f"Pressed {key}.", "detail": result}

        return {"ok": True, "reply": f"Done with {action}.", "detail": result}

    if result.get("refused"):
        return {"ok": False, "reply": f"Guard refused: {result.get('reason', '')[:80]}", "detail": result}
    if result.get("pending_approval"):
        return {"ok": False, "reply": "That command needs your approval first.", "detail": result}

    err = result.get("error") or result.get("reason") or "unknown error"
    return {"ok": False, "reply": f"Failed: {err}", "detail": result}

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        text = " ".join(sys.argv[1:])
        r = dispatch(text)
        print(json.dumps(r, indent=2))
    else:
        print("Dispatcher v2 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â LLM-first mode. Type a command, or 'quit'.")
        while True:
            try:
                line = input("> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if not line or line.lower() in ("quit", "exit"):
                break
            r = dispatch(line)
            mark = "OK " if r["ok"] else "ERR"
            print(f"  [{mark}] {r['reply']}")