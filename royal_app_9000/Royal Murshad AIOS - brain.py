"""
Royal Jarvis - Brain v5 (fast-path + LLM fallback)
"""
from __future__ import annotations
import json
import re
import urllib.error
import urllib.request

OLLAMA = "http://127.0.0.1:11434"
MODEL = "qwen2.5:3b"

SYSTEM_PROMPT = """You are the intent classifier for a voice-controlled assistant called Jarvis.

Possible intents:
  open_app        - open/launch an app. Fill "app".
  close_app       - close an app. Fill "app".
  screenshot      - user wants a screenshot.
  list_apps       - user wants the list of apps.
  greeting        - greeting the assistant.
  meta            - asking what the assistant can do.
  stop            - user wants to stop listening.
  read_screen     - what is on the screen right now.
  find_on_screen  - locate text on screen. Fill "text".
  click_on_screen - click text on screen. Fill "text".
  type_text       - type text. Fill "text".
  press_key       - press a key. Fill "key".
  time            - current time.
  date            - current date.
  volume_up       - louder.
  volume_down     - quieter.
  mute            - mute.
  check_messages  - read messages on a messaging app. Fill "app" with telegram|whatsapp|slack|discord. Fill "who" with the contact.
  send_reply      - send a specific message. Fill "text" with the body.
  unknown         - cannot guess.

Reply with ONLY valid JSON, nothing else.

Format: {"intent": "...", "app": "", "who": "", "text": "", "key": "", "confidence": 0.0-1.0}

Examples:
  "hello journalists"   -> {"intent":"greeting","app":"","who":"","confidence":1.0}
  "open note pad"       -> {"intent":"open_app","app":"notepad","who":"","confidence":1.0}
  "what time is it"     -> {"intent":"time","app":"","who":"","confidence":1.0}
  "check telegram from alice"   -> {"intent":"check_messages","app":"telegram","who":"alice","confidence":1.0}
  "read my whatsapp from mom"   -> {"intent":"check_messages","app":"whatsapp","who":"mom","confidence":1.0}
  "say i will be there at 11"   -> {"intent":"send_reply","text":"i will be there at 11","confidence":1.0}
"""

_KNOWN_APPS = {"notepad","chrome","calculator","calc","vscode","code",
               "explorer","cmd","powershell","spotify","discord","paint",
               "edge","firefox","terminal","wt"}


def _fast_classify(text):
    """Skip the LLM for obvious phrasings. Returns None if uncertain."""
    t = (text or "").lower().strip()

    for a in ("telegram", "whatsapp", "slack", "discord"):
        if a in t:
            m = re.search(r"(?:from|with|chat\s+with)\s+([a-z0-9 _\-]+?)(?:\s+on|\s+in|$)", t)
            if m:
                return {"intent": "check_messages", "app": a,
                        "who": m.group(1).strip().title(),
                        "confidence": 1.0, "raw_reply": "(fast-path)", "error": None}

    if any(k in t for k in ("what time", "what is the time", "the time is")):
        return {"intent": "time", "app": "", "who": "", "confidence": 1.0,
                "raw_reply": "(fast-path)", "error": None}
    if any(k in t for k in ("what date", "what day", "todays date", "today is")):
        return {"intent": "date", "app": "", "who": "", "confidence": 1.0,
                "raw_reply": "(fast-path)", "error": None}

    if any(k in t for k in ("turn it up", "louder", "volume up")):
        return {"intent": "volume_up", "app": "", "who": "", "confidence": 1.0,
                "raw_reply": "(fast-path)", "error": None}
    if any(k in t for k in ("turn it down", "quieter", "volume down")):
        return {"intent": "volume_down", "app": "", "who": "", "confidence": 1.0,
                "raw_reply": "(fast-path)", "error": None}
    if t == "mute":
        return {"intent": "mute", "app": "", "who": "", "confidence": 1.0,
                "raw_reply": "(fast-path)", "error": None}

    if t in ("hello jarvis", "hi jarvis", "hey jarvis", "hello", "hi", "hey"):
        return {"intent": "greeting", "app": "", "who": "", "confidence": 1.0,
                "raw_reply": "(fast-path)", "error": None}

    m = re.match(r"(?:please\s+)?open\s+([a-z0-9 _\-]+)", t)
    if m:
        target = m.group(1).strip()
        if target in _KNOWN_APPS:
            return {"intent": "open_app", "app": target, "who": "",
                    "confidence": 1.0, "raw_reply": "(fast-path)", "error": None}

    if "screenshot" in t:
        return {"intent": "screenshot", "app": "", "who": "", "confidence": 1.0,
                "raw_reply": "(fast-path)", "error": None}

    return None


def understand(text):
    """Classify what the user meant. Fast-path first, then LLM."""
    fast = _fast_classify(text)
    if fast is not None:
        return fast

    prompt = SYSTEM_PROMPT + "\n\nUser said: \"" + text + "\"\n\nJSON:"
    try:
        req = urllib.request.Request(
            OLLAMA + "/api/generate",
            data=json.dumps({
                "model": MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 80, "keep_alive": "30m"},
            }).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            reply = json.loads(r.read().decode())["response"].strip()

        start = reply.find("{")
        end = reply.rfind("}")
        if start >= 0 and end > start:
            parsed = json.loads(reply[start:end + 1])
            parsed.setdefault("intent", "unknown")
            parsed.setdefault("app", "")
            parsed.setdefault("who", "")
            parsed.setdefault("confidence", 0.0)
            parsed["raw_reply"] = reply
            parsed["error"] = None
            return parsed
        return {"intent": "unknown", "app": "", "who": "", "confidence": 0.0,
                "raw_reply": reply, "error": "no JSON found"}
    except Exception as e:
        return {"intent": "unknown", "app": "", "who": "", "confidence": 0.0,
                "raw_reply": "", "error": str(e)}


if __name__ == "__main__":
    import sys
    tests = sys.argv[1:] or ["hello jarvis", "open notepad", "check telegram from alice"]
    for t in tests:
        r = understand(t)
        print("  " + t)
        print("    -> intent=" + str(r.get("intent")) + "  app=" + str(r.get("app")) + "  who=" + str(r.get("who")))
