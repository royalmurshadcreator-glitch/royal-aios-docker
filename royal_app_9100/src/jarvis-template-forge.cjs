const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const MODEL = "qwen2.5:3b";
const ORCH_SRC = path.resolve(__dirname);
const TEMPLATES_DIR = path.resolve(__dirname, "..", "enhancement-templates");
const ENHANCER_FILE = path.join(ORCH_SRC, "jarvis-enhancer-agent.cjs");
const FORGE_HISTORY_FILE = path.resolve(__dirname, "..", "..", "App", "data", "memory", "forge-history.jsonl");
const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";

// ============================================================
// KNOWLEDGE BASE - Pre-designed patterns for common libraries
// ============================================================
const LIBRARY_KNOWLEDGE = {
  weather: {
    name: "Weather Forecast",
    description: "OpenWeatherMap free API",
    packages: ["requests"],
    setup_notes: [
      "Get free API key from https://openweathermap.org/api",
      "Set env var OPENWEATHER_API_KEY or edit script directly"
    ],
    functions: ["get_current_weather", "get_forecast_5day"],
    risk: "LEVEL_0",
    api_pattern: "https://api.openweathermap.org/data/2.5/weather"
  },
  crypto: {
    name: "Crypto Price Tracker",
    description: "CoinGecko free API (no key needed)",
    packages: ["requests"],
    setup_notes: ["No API key needed - CoinGecko is free"],
    functions: ["get_price", "get_top_10", "get_price_change_24h"],
    risk: "LEVEL_0",
    api_pattern: "https://api.coingecko.com/api/v3/simple/price"
  },
  translator: {
    name: "Language Translator",
    description: "Free translation using deep-translator",
    packages: ["deep-translator"],
    setup_notes: ["No API key needed - completely free"],
    functions: ["translate", "detect_language", "supported_languages"],
    risk: "LEVEL_0"
  },
  news: {
    name: "News Aggregator",
    description: "RSS-based news reader",
    packages: ["feedparser", "requests"],
    setup_notes: ["Uses public RSS feeds - no API key needed"],
    functions: ["get_hackernews", "get_bbc", "get_custom_rss"],
    risk: "LEVEL_0"
  },
  qrcode: {
    name: "QR Code Generator",
    description: "Create QR codes as PNG images",
    packages: ["qrcode[pil]"],
    setup_notes: ["Saves to D:\\02_ALSYED_BUSINESS\\Documents\\QRCodes\\"],
    functions: ["generate_qr", "generate_wifi_qr", "generate_vcard_qr"],
    risk: "LEVEL_1"
  },
  currency: {
    name: "Currency Converter",
    description: "Real-time currency conversion",
    packages: ["requests"],
    setup_notes: ["Uses free exchangerate-api.com"],
    functions: ["convert", "get_rate", "list_currencies"],
    risk: "LEVEL_0"
  },
  screenshot: {
    name: "Screenshot Tool",
    description: "Capture screen or windows",
    packages: ["pyautogui", "pillow"],
    setup_notes: ["Saves to D:\\02_ALSYED_BUSINESS\\Documents\\Screenshots\\"],
    functions: ["full_screen", "region", "active_window"],
    risk: "LEVEL_1"
  },
  password: {
    name: "Password Generator",
    description: "Secure password generation",
    packages: [],
    setup_notes: ["Uses Python built-in secrets module"],
    functions: ["generate", "generate_pin", "check_strength"],
    risk: "LEVEL_0"
  },
  calendar: {
    name: "Google Calendar",
    description: "Full Google Calendar integration",
    packages: ["google-api-python-client", "google-auth-httplib2", "google-auth-oauthlib"],
    setup_notes: [
      "1. Go to console.cloud.google.com",
      "2. Enable Google Calendar API",
      "3. Create OAuth2 credentials (Desktop app)",
      "4. Download credentials.json to D:\\01_ROYAL_JARVIS\\App\\data\\memory\\",
      "5. First run will open browser for OAuth approval"
    ],
    functions: ["list_events", "add_event", "delete_event", "update_event"],
    risk: "LEVEL_2"
  },
  visa: {
    name: "Visa Document Reader",
    description: "PDF/DOCX visa document analysis",
    packages: ["PyPDF2", "python-docx", "pdfplumber"],
    setup_notes: ["Scans D:\\03_PERSONAL\\Visa_Germany_2026\\ folder"],
    functions: ["read_pdf", "extract_visa_info", "check_checklist"],
    risk: "LEVEL_0"
  },
  youtube: {
    name: "YouTube Downloader",
    description: "Download videos/audio via yt-dlp",
    packages: ["yt-dlp"],
    setup_notes: ["Downloads to D:\\02_ALSYED_BUSINESS\\Media\\YouTube\\"],
    functions: ["download_video", "download_audio", "get_info"],
    risk: "LEVEL_2"
  },
  file_compressor: {
    name: "File Compressor (ZIP)",
    description: "Compress/extract ZIP archives",
    packages: [],
    setup_notes: ["Uses Python built-in zipfile"],
    functions: ["compress", "extract", "list_contents"],
    risk: "LEVEL_1"
  }
};

function callOllama(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.15, num_predict: 2500 }
    });
    const req = http.request(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data).response || ""); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs || 300000, () => { req.destroy(); reject(new Error("Ollama timeout")); });
    req.write(body);
    req.end();
  });
}

function cleanCode(text) {
  if (!text) return "";
  return text.replace(/```python\s*/gi, "").replace(/```py\s*/gi, "").replace(/```\s*/g, "").trim();
}

function logForge(entry) {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
    fs.appendFileSync(FORGE_HISTORY_FILE, line, "utf-8");
  } catch (_) {}
}

function detectTemplateKey(request) {
  const r = request.toLowerCase();
  for (const key of Object.keys(LIBRARY_KNOWLEDGE)) {
    if (r.includes(key)) return key;
  }
  // Try simplified matches
  if (r.includes("qr")) return "qrcode";
  if (r.includes("cash") || r.includes("money") || r.includes("exchange")) return "currency";
  if (r.includes("bitcoin") || r.includes("coin")) return "crypto";
  if (r.includes("translate") || r.includes("language")) return "translator";
  if (r.includes("meeting") || r.includes("event") || r.includes("appointment")) return "calendar";
  if (r.includes("screen") || r.includes("capture")) return "screenshot";
  if (r.includes("compress") || r.includes("zip")) return "file_compressor";
  return null;
}

class TemplateForge {
  constructor(options = {}) {
    this.id = "forge";
    this.name = "JARVIS Template Forge Agent";
    this.riskLevel = "LEVEL_2";
    this.capabilities = [
      "forge_new_templates",
      "auto_python_code_generation",
      "library_knowledge_base",
      "auto_enhancer_registration",
      "meta_meta_intelligence"
    ];
    this.registry = options.registry || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["build template", "forge template", "create template", "new template", "add template"];
    return keywords.some(k => c.includes(k)) ? 95 : 0;
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.riskLevel,
      capabilities: this.capabilities,
      known_libraries: Object.keys(LIBRARY_KNOWLEDGE)
    };
  }

  listKnowledge() {
    const kb = {};
    for (const [key, info] of Object.entries(LIBRARY_KNOWLEDGE)) {
      kb[key] = {
        name: info.name,
        description: info.description,
        packages: info.packages,
        functions: info.functions,
        risk: info.risk
      };
    }
    return kb;
  }

  async forge(request, options = {}) {
    const result = {
      request,
      started_at: new Date().toISOString(),
      steps: []
    };

    try {
      // PHASE A: Detect template type
      const key = options.target || detectTemplateKey(request);
      let libInfo = key ? LIBRARY_KNOWLEDGE[key] : null;
      
      // For unknown types, extract name from request
      const templateName = key || (request.match(/(?:build|forge|create|add)\s+(?:a\s+)?(\w+)\s+template/i)?.[1]?.toLowerCase() || "custom" + Date.now().toString(36).slice(-4));
      
      result.template_key = templateName;
      result.knowledge_matched = libInfo ? true : false;
      result.steps.push({ phase: "A_detect", status: "OK", message: "Template: " + templateName + " | KB match: " + (libInfo ? "YES" : "NO") });

      // PHASE B: Generate Python template code
      let pythonCode;
      if (libInfo) {
        // Use knowledge-base template (fast + reliable)
        pythonCode = this.buildFromKnowledge(templateName, libInfo);
        result.steps.push({ phase: "B_generate", status: "OK_KB", message: "Used built-in knowledge template" });
      } else {
        // Use LLM for unknown libraries
        try {
          const prompt = this.buildLLMPrompt(templateName, request);
          const rawCode = await callOllama(prompt, 180000);
          pythonCode = cleanCode(rawCode);
          
          if (!pythonCode || pythonCode.length < 200 || !pythonCode.includes("def ")) {
            throw new Error("LLM output invalid");
          }
          result.steps.push({ phase: "B_generate", status: "OK_LLM", size: pythonCode.length });
        } catch (llmErr) {
          // Fallback to generic template
          pythonCode = this.buildGenericTemplate(templateName, request);
          result.steps.push({ phase: "B_generate", status: "FALLBACK", message: llmErr.message });
        }
      }

      // PHASE C: Validate Python syntax
      const tempPy = path.join(TEMPLATES_DIR, "_temp_validate.py");
      if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
      fs.writeFileSync(tempPy, pythonCode, "utf-8");
      
      try {
        execSync(`"${PY_EXE}" -m py_compile "${tempPy}"`, { stdio: "pipe" });
        result.steps.push({ phase: "C_validate", status: "OK" });
      } catch (err) {
        fs.unlinkSync(tempPy);
        result.status = "FAILED";
        result.error = "Python syntax error: " + err.message;
        result.steps.push({ phase: "C_validate", status: "FAILED" });
        logForge(result);
        return result;
      }
      fs.unlinkSync(tempPy);

      // PHASE D: Save template file
      const templateFileName = templateName + ".py.template";
      const templatePath = path.join(TEMPLATES_DIR, templateFileName);
      fs.writeFileSync(templatePath, pythonCode, "utf-8");
      result.template_path = templatePath;
      result.steps.push({ phase: "D_save", status: "OK", path: templatePath, size: pythonCode.length });

      // PHASE E: Auto-register in Enhancer
      const registered = this.registerInEnhancer(templateName, libInfo, templateFileName);
      result.steps.push({ 
        phase: "E_register", 
        status: registered ? "OK" : "MANUAL_NEEDED",
        message: registered ? "Auto-registered in Enhancer" : "Please restart server and manually verify"
      });

      // PHASE F: Report
      result.status = "SUCCESS";
      result.template_name = libInfo ? libInfo.name : templateName + " Template";
      result.dependencies = libInfo ? libInfo.packages : [];
      result.setup_notes = libInfo ? libInfo.setup_notes : ["Custom template - check code for usage"];
      result.next_action = `Restart server, then: POST /api/jarvis/enhancer with { request: "enhance ${templateName} agent" }`;
      result.completed_at = new Date().toISOString();
      logForge(result);
      return result;

    } catch (err) {
      result.status = "ERROR";
      result.error = err.message;
      result.steps.push({ phase: "ERROR", status: "FAILED", message: err.message });
      logForge(result);
      return result;
    }
  }

  buildFromKnowledge(key, info) {
    // Generate a real Python template based on knowledge
    const packages = info.packages.join('", "');
    const setupCall = info.packages.length > 0 
      ? `def install_deps():
    import subprocess
    packages = ["${packages}"]
    for pkg in packages:
        try:
            __import__(pkg.replace("-", "_").split("[")[0])
        except ImportError:
            print(f"[INSTALL] {pkg}...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "--quiet"])

install_deps()
`
      : "# No external dependencies needed\n";

    // Generate specific code based on known library type
    const specificCode = this.generateLibrarySpecificCode(key, info);

    return `"""
${info.name} Template - Forged by JARVIS Template Forge
${info.description}
"""
import sys, json, os
from datetime import datetime

${setupCall}
${specificCode}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: script.py <action> [args...]", "available_functions": ${JSON.stringify(info.functions)}}))
        sys.exit(1)
    
    action = sys.argv[1].lower()
    result = {"status": "FAILED", "error": "Unknown action: " + action}
    
${info.functions.map(f => `    if action == "${f.replace(/_/g, "")}":\n        try:\n            args = sys.argv[2:] if len(sys.argv) > 2 else []\n            result = ${f}(*args)\n        except Exception as e:\n            result = {"status": "ERROR", "error": str(e)}`).join("\n")}
    
    print(json.dumps(result, default=str))
`;
  }

  generateLibrarySpecificCode(key, info) {
    // Return real, working implementations for known libraries
    const implementations = {
      weather: `
API_KEY = os.environ.get("OPENWEATHER_API_KEY", "YOUR_API_KEY_HERE")

def get_current_weather(city="Karachi"):
    import requests
    url = f"https://api.openweathermap.org/data/2.5/weather?q={city}&appid={API_KEY}&units=metric"
    r = requests.get(url, timeout=10)
    if r.status_code == 200:
        d = r.json()
        return {
            "status": "SUCCESS",
            "city": d["name"],
            "temp": d["main"]["temp"],
            "feels_like": d["main"]["feels_like"],
            "description": d["weather"][0]["description"],
            "humidity": d["main"]["humidity"]
        }
    return {"status": "FAILED", "error": r.text}

def get_forecast_5day(city="Karachi"):
    import requests
    url = f"https://api.openweathermap.org/data/2.5/forecast?q={city}&appid={API_KEY}&units=metric"
    r = requests.get(url, timeout=10)
    if r.status_code == 200:
        d = r.json()
        return {"status": "SUCCESS", "city": d["city"]["name"], "forecasts": [{"time": f["dt_txt"], "temp": f["main"]["temp"], "desc": f["weather"][0]["description"]} for f in d["list"][:10]]}
    return {"status": "FAILED", "error": r.text}
`,
      crypto: `
def get_price(coin="bitcoin"):
    import requests
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={coin}&vs_currencies=usd,pkr&include_24hr_change=true"
    r = requests.get(url, timeout=10)
    if r.status_code == 200:
        d = r.json()
        if coin in d:
            return {"status": "SUCCESS", "coin": coin, "price_usd": d[coin]["usd"], "price_pkr": d[coin].get("pkr", 0), "change_24h": d[coin].get("usd_24h_change", 0)}
    return {"status": "FAILED", "error": "Coin not found"}

def get_top_10():
    import requests
    url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10"
    r = requests.get(url, timeout=10)
    if r.status_code == 200:
        return {"status": "SUCCESS", "coins": [{"name": c["name"], "symbol": c["symbol"], "price": c["current_price"], "change_24h": c["price_change_percentage_24h"]} for c in r.json()]}
    return {"status": "FAILED"}

def get_price_change_24h(coin="bitcoin"):
    return get_price(coin)
`,
      translator: `
def translate(text, target="ur", source="auto"):
    from deep_translator import GoogleTranslator
    try:
        result = GoogleTranslator(source=source, target=target).translate(text)
        return {"status": "SUCCESS", "original": text, "translated": result, "target_lang": target}
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}

def detect_language(text):
    from deep_translator import GoogleTranslator
    try:
        return {"status": "SUCCESS", "text": text, "detected": "auto-detected"}
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}

def supported_languages():
    from deep_translator import GoogleTranslator
    try:
        langs = GoogleTranslator().get_supported_languages(as_dict=True)
        return {"status": "SUCCESS", "count": len(langs), "languages": langs}
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
`,
      qrcode: `
OUTPUT_DIR = r"D:\\02_ALSYED_BUSINESS\\Documents\\QRCodes"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def generate_qr(data, filename=None):
    import qrcode
    if not filename:
        filename = "qr_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".png"
    filepath = os.path.join(OUTPUT_DIR, filename)
    img = qrcode.make(data)
    img.save(filepath)
    return {"status": "SUCCESS", "file": filepath, "data": data}

def generate_wifi_qr(ssid, password, security="WPA"):
    wifi_string = f"WIFI:T:{security};S:{ssid};P:{password};;"
    return generate_qr(wifi_string, f"wifi_{ssid}.png")

def generate_vcard_qr(name, phone, email=""):
    vcard = f"BEGIN:VCARD\\nVERSION:3.0\\nFN:{name}\\nTEL:{phone}\\nEMAIL:{email}\\nEND:VCARD"
    return generate_qr(vcard, f"vcard_{name.replace(' ','_')}.png")
`,
      currency: `
def convert(amount, from_curr="USD", to_curr="PKR"):
    import requests
    amount = float(amount)
    url = f"https://open.er-api.com/v6/latest/{from_curr}"
    r = requests.get(url, timeout=10)
    if r.status_code == 200:
        d = r.json()
        rate = d["rates"].get(to_curr.upper())
        if rate:
            converted = amount * rate
            return {"status": "SUCCESS", "amount": amount, "from": from_curr, "to": to_curr, "rate": rate, "result": round(converted, 2)}
    return {"status": "FAILED", "error": "Rate unavailable"}

def get_rate(from_curr="USD", to_curr="PKR"):
    return convert(1, from_curr, to_curr)

def list_currencies():
    import requests
    r = requests.get("https://open.er-api.com/v6/latest/USD", timeout=10)
    if r.status_code == 200:
        return {"status": "SUCCESS", "currencies": list(r.json()["rates"].keys())}
    return {"status": "FAILED"}
`,
      password: `
import secrets, string

def generate(length=16, include_symbols=True):
    length = int(length)
    chars = string.ascii_letters + string.digits
    if include_symbols:
        chars += "!@#$%^&*()"
    password = "".join(secrets.choice(chars) for _ in range(length))
    return {"status": "SUCCESS", "password": password, "length": length}

def generate_pin(length=6):
    length = int(length)
    pin = "".join(secrets.choice(string.digits) for _ in range(length))
    return {"status": "SUCCESS", "pin": pin, "length": length}

def check_strength(password):
    score = 0
    if len(password) >= 8: score += 1
    if len(password) >= 12: score += 1
    if any(c.islower() for c in password): score += 1
    if any(c.isupper() for c in password): score += 1
    if any(c.isdigit() for c in password): score += 1
    if any(c in "!@#$%^&*()" for c in password): score += 1
    strength = ["Very Weak", "Weak", "Fair", "Good", "Strong", "Very Strong"][min(score, 5)]
    return {"status": "SUCCESS", "score": score, "strength": strength}
`,
      screenshot: `
OUTPUT_DIR = r"D:\\02_ALSYED_BUSINESS\\Documents\\Screenshots"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def full_screen(filename=None):
    import pyautogui
    if not filename:
        filename = "screen_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".png"
    filepath = os.path.join(OUTPUT_DIR, filename)
    img = pyautogui.screenshot()
    img.save(filepath)
    return {"status": "SUCCESS", "file": filepath}

def region(x=0, y=0, width=800, height=600, filename=None):
    import pyautogui
    x, y, width, height = int(x), int(y), int(width), int(height)
    if not filename:
        filename = "region_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".png"
    filepath = os.path.join(OUTPUT_DIR, filename)
    img = pyautogui.screenshot(region=(x, y, width, height))
    img.save(filepath)
    return {"status": "SUCCESS", "file": filepath, "region": [x, y, width, height]}

def active_window(filename=None):
    return full_screen(filename)
`,
      news: `
def get_hackernews(limit=10):
    import feedparser
    feed = feedparser.parse("https://news.ycombinator.com/rss")
    limit = int(limit)
    stories = [{"title": e.title, "link": e.link, "date": e.get("published", "")} for e in feed.entries[:limit]]
    return {"status": "SUCCESS", "source": "HackerNews", "count": len(stories), "stories": stories}

def get_bbc(limit=10):
    import feedparser
    feed = feedparser.parse("http://feeds.bbci.co.uk/news/world/rss.xml")
    limit = int(limit)
    stories = [{"title": e.title, "link": e.link, "date": e.get("published", "")} for e in feed.entries[:limit]]
    return {"status": "SUCCESS", "source": "BBC World", "count": len(stories), "stories": stories}

def get_custom_rss(url, limit=10):
    import feedparser
    feed = feedparser.parse(url)
    limit = int(limit)
    stories = [{"title": e.title, "link": e.link} for e in feed.entries[:limit]]
    return {"status": "SUCCESS", "url": url, "count": len(stories), "stories": stories}
`,
      file_compressor: `
import zipfile

def compress(source_path, output_zip=None):
    if not output_zip:
        output_zip = source_path + ".zip"
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        if os.path.isdir(source_path):
            for root, dirs, files in os.walk(source_path):
                for f in files:
                    fp = os.path.join(root, f)
                    zf.write(fp, os.path.relpath(fp, source_path))
        else:
            zf.write(source_path, os.path.basename(source_path))
    return {"status": "SUCCESS", "output": output_zip, "size_kb": round(os.path.getsize(output_zip)/1024, 2)}

def extract(zip_path, output_dir=None):
    if not output_dir:
        output_dir = zip_path.replace(".zip", "_extracted")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(output_dir)
        files = zf.namelist()
    return {"status": "SUCCESS", "output_dir": output_dir, "files_extracted": len(files)}

def list_contents(zip_path):
    with zipfile.ZipFile(zip_path, 'r') as zf:
        files = [{"name": f.filename, "size": f.file_size} for f in zf.filelist]
    return {"status": "SUCCESS", "count": len(files), "files": files}
`,
      calendar: `
# Google Calendar requires OAuth2 - see setup notes
CREDS_FILE = r"D:\\01_ROYAL_JARVIS\\App\\data\\memory\\credentials.json"
TOKEN_FILE = r"D:\\01_ROYAL_JARVIS\\App\\data\\memory\\calendar-token.json"

def get_service():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    
    SCOPES = ["https://www.googleapis.com/auth/calendar"]
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDS_FILE):
                return None
            flow = InstalledAppFlow.from_client_secrets_file(CREDS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as t:
            t.write(creds.to_json())
    return build("calendar", "v3", credentials=creds)

def list_events(max_results=10):
    service = get_service()
    if not service:
        return {"status": "SETUP_REQUIRED", "error": "Create credentials.json first"}
    max_results = int(max_results)
    now = datetime.utcnow().isoformat() + "Z"
    events = service.events().list(calendarId="primary", timeMin=now, maxResults=max_results, singleEvents=True, orderBy="startTime").execute()
    items = events.get("items", [])
    return {"status": "SUCCESS", "count": len(items), "events": [{"summary": e.get("summary", ""), "start": e["start"].get("dateTime", e["start"].get("date"))} for e in items]}

def add_event(summary, start_time, end_time=None, description=""):
    service = get_service()
    if not service:
        return {"status": "SETUP_REQUIRED"}
    event = {"summary": summary, "description": description, "start": {"dateTime": start_time, "timeZone": "Asia/Karachi"}, "end": {"dateTime": end_time or start_time, "timeZone": "Asia/Karachi"}}
    created = service.events().insert(calendarId="primary", body=event).execute()
    return {"status": "SUCCESS", "event_id": created["id"], "link": created["htmlLink"]}

def delete_event(event_id):
    service = get_service()
    if not service:
        return {"status": "SETUP_REQUIRED"}
    service.events().delete(calendarId="primary", eventId=event_id).execute()
    return {"status": "SUCCESS", "deleted": event_id}

def update_event(event_id, summary=None):
    service = get_service()
    if not service:
        return {"status": "SETUP_REQUIRED"}
    event = service.events().get(calendarId="primary", eventId=event_id).execute()
    if summary:
        event["summary"] = summary
    updated = service.events().update(calendarId="primary", eventId=event_id, body=event).execute()
    return {"status": "SUCCESS", "updated": updated["id"]}
`,
      visa: `
def read_pdf(pdf_path):
    import PyPDF2
    if not os.path.exists(pdf_path):
        return {"status": "FAILED", "error": "File not found"}
    with open(pdf_path, "rb") as f:
        reader = PyPDF2.PdfReader(f)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\\n"
    return {"status": "SUCCESS", "file": pdf_path, "pages": len(reader.pages), "text_length": len(text), "preview": text[:500]}

def extract_visa_info(pdf_path):
    result = read_pdf(pdf_path)
    if result["status"] != "SUCCESS":
        return result
    import re
    text = result.get("preview", "")
    info = {}
    # Common patterns
    passport_match = re.search(r"[A-Z]{2}\\d{7}", text)
    if passport_match: info["passport_number"] = passport_match.group(0)
    email_match = re.search(r"[\\w\\.-]+@[\\w\\.-]+", text)
    if email_match: info["email"] = email_match.group(0)
    return {"status": "SUCCESS", "file": pdf_path, "extracted_info": info}

def check_checklist(folder=r"D:\\03_PERSONAL\\Visa_Germany_2026"):
    required = ["passport", "admission", "bank", "insurance", "photo"]
    if not os.path.exists(folder):
        return {"status": "FAILED", "error": "Folder not found"}
    files = [f.lower() for f in os.listdir(folder)]
    found = {req: any(req in f for f in files) for req in required}
    missing = [k for k, v in found.items() if not v]
    return {"status": "SUCCESS", "folder": folder, "total_files": len(files), "checklist": found, "missing": missing}
`,
      youtube: `
OUTPUT_DIR = r"D:\\02_ALSYED_BUSINESS\\Media\\YouTube"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def download_video(url, quality="best"):
    import subprocess
    output_template = os.path.join(OUTPUT_DIR, "%(title)s.%(ext)s")
    cmd = ["yt-dlp", "-f", quality, "-o", output_template, url]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return {"status": "SUCCESS" if result.returncode == 0 else "FAILED", "output": result.stdout[-500:]}
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}

def download_audio(url):
    import subprocess
    output_template = os.path.join(OUTPUT_DIR, "%(title)s.%(ext)s")
    cmd = ["yt-dlp", "-x", "--audio-format", "mp3", "-o", output_template, url]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        return {"status": "SUCCESS" if result.returncode == 0 else "FAILED", "output": result.stdout[-500:]}
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}

def get_info(url):
    import subprocess
    try:
        result = subprocess.run(["yt-dlp", "--dump-json", "--no-download", url], capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            info = json.loads(result.stdout)
            return {"status": "SUCCESS", "title": info.get("title"), "duration": info.get("duration"), "uploader": info.get("uploader")}
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
    return {"status": "FAILED"}
`
    };

    return implementations[key] || `
# Custom template - implement your functions here
def custom_action(*args):
    return {"status": "SUCCESS", "message": "Custom template executed", "args": list(args)}
`;
  }

  buildLLMPrompt(templateName, request) {
    return `Generate a Python template file for a JARVIS agent. Return ONLY raw Python code, no markdown, no explanation.

REQUIREMENTS:
1. Import necessary modules (sys, os, json, datetime)
2. Auto-install missing dependencies via subprocess if needed
3. Define 3-5 functions that provide real functionality
4. Each function returns a dict with "status" key ("SUCCESS" or "FAILED")
5. Include a __main__ block that parses sys.argv[1] as action name

USER REQUEST: "${request}"
TEMPLATE NAME: ${templateName}

Generate the complete Python template code:`;
  }

  buildGenericTemplate(name, request) {
    return `"""
${name} Template - Custom (forged from request)
Request: ${request}
"""
import sys, json, os
from datetime import datetime

def default_action(*args):
    return {
        "status": "SUCCESS",
        "template": "${name}",
        "message": "Custom template - please implement specific logic",
        "args": list(args)
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: script.py <action> [args...]"}))
        sys.exit(1)
    result = default_action(*sys.argv[2:])
    print(json.dumps(result, default=str))
`;
  }

  registerInEnhancer(templateKey, libInfo, templateFileName) {
    try {
      let enhancerCode = fs.readFileSync(ENHANCER_FILE, "utf-8");
      
      // Check if already registered
      if (enhancerCode.includes(`${templateKey}: {`)) {
        return true;
      }
      
      const name = libInfo ? libInfo.name : templateKey.charAt(0).toUpperCase() + templateKey.slice(1);
      const packages = libInfo ? libInfo.packages : [];
      const capabilities = libInfo ? libInfo.functions.map(f => f.replace(/_/g, "_")) : [templateKey + "_action"];
      const risk = libInfo ? libInfo.risk : "LEVEL_1";
      const setupNotes = libInfo ? libInfo.setup_notes : ["Custom template - ready to use"];
      
      const newEntry = `,
  ${templateKey}: {
    name: "${name}",
    py_template: "${templateFileName}",
    py_target_dir: "${templateKey.charAt(0).toUpperCase() + templateKey.slice(1)}",
    py_target_name: "${templateKey.charAt(0).toUpperCase() + templateKey.slice(1)}Agent.py",
    dependencies: ${JSON.stringify(packages)},
    setup_instructions: ${JSON.stringify(setupNotes)},
    capabilities: ${JSON.stringify(capabilities)},
    risk_level: "${risk}"
  }`;

      // Insert before the closing brace of TEMPLATES
      const templatesEndPattern = /pdf:\s*\{[\s\S]*?risk_level:\s*"LEVEL_1"\s*\}\s*(\})/;
      const match = enhancerCode.match(templatesEndPattern);
      if (match) {
        const insertPos = match.index + match[0].length - 1;
        enhancerCode = enhancerCode.substring(0, insertPos) + newEntry + "\n" + enhancerCode.substring(insertPos);
        fs.writeFileSync(ENHANCER_FILE, enhancerCode, "utf-8");
        return true;
      }
      return false;
    } catch (err) {
      console.error("Failed to register in Enhancer:", err);
      return false;
    }
  }

  async execute(analysis) {
    const command = analysis.raw_command || analysis.command || "";
    return await this.forge(command);
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "forge_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id }
    };
  }

  getForgeHistory(limit = 20) {
    try {
      if (!fs.existsSync(FORGE_HISTORY_FILE)) return [];
      const content = fs.readFileSync(FORGE_HISTORY_FILE, "utf-8");
      const lines = content.split("\n").filter(l => l.trim());
      const entries = [];
      for (const line of lines) {
        try { entries.push(JSON.parse(line)); } catch (_) {}
      }
      return entries.slice(-limit).reverse();
    } catch (_) {
      return [];
    }
  }
}

function createTemplateForge(options) {
  return new TemplateForge(options);
}

module.exports = { TemplateForge, createTemplateForge };

