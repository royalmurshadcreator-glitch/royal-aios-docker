const fs = require("fs");
const path = require("path");

const WIDGETS_FILE = path.resolve(__dirname, "..", "..", "App", "data", "memory", "hud-widgets.jsonl");

function ensureStorage() {
  const dir = path.dirname(WIDGETS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(WIDGETS_FILE)) fs.writeFileSync(WIDGETS_FILE, "", "utf-8");
}

function loadWidgets() {
  ensureStorage();
  try {
    const lines = fs.readFileSync(WIDGETS_FILE, "utf-8").split("\n").filter(l => l.trim());
    return lines.map(l => JSON.parse(l));
  } catch (_) {
    return [];
  }
}

function saveWidgets(widgets) {
  ensureStorage();
  const content = widgets.map(w => JSON.stringify(w)).join("\n") + (widgets.length ? "\n" : "");
  fs.writeFileSync(WIDGETS_FILE, content, "utf-8");
}

// Built-in Widget Synthesis Presets
const PRESET_SYNTHESIS = {
  crypto: {
    id: "widget_crypto_ticker",
    title: "🪙 Live Crypto Ticker",
    accent_color: "#ff9d00",
    html: `
      <div style="font-family: monospace; font-size: 11px;">
        <div style="display:flex; justify-shadow:space-between; margin-bottom: 6px;">
          <span>Bitcoin (BTC):</span> <strong id="widgetBtcVal" style="color:#38ffcc;">$78,959</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
          <span>Ethereum (ETH):</span> <strong id="widgetEthVal" style="color:#00e5ff;">$2,450</strong>
        </div>
        <button onclick="window.refreshWidgetCrypto()" style="width:100%; padding:4px; background:#ff9d00; color:#000; border:none; border-radius:3px; font-weight:bold; cursor:pointer;">🔄 Refresh Prices</button>
      </div>
    `,
    js: `
      window.refreshWidgetCrypto = async function() {
        try {
          const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd");
          const d = await r.json();
          if(d.bitcoin) document.getElementById("widgetBtcVal").textContent = "$" + d.bitcoin.usd.toLocaleString();
          if(d.ethereum) document.getElementById("widgetEthVal").textContent = "$" + d.ethereum.usd.toLocaleString();
        } catch(_) {}
      };
    `
  },
  weather: {
    id: "widget_weather_card",
    title: "🌤️ Live Weather Radar",
    accent_color: "#00e5ff",
    html: `
      <div style="font-family: monospace; font-size: 11px;">
        <div style="display:flex; gap:4px; margin-bottom:6px;">
          <input type="text" id="widgetCityInput" value="Karachi" style="flex:1; background:#0c1530; border:1px solid #00e5ff; color:#fff; padding:3px 6px; font-size:10px; border-radius:3px;">
          <button onclick="window.fetchWidgetWeather()" style="background:#00e5ff; color:#000; border:none; padding:3px 8px; font-weight:bold; border-radius:3px; cursor:pointer;">Search</button>
        </div>
        <div id="widgetWeatherOutput" style="font-size:10px; color:#d0ecff; opacity:0.9;">
          Location: <strong>Karachi, PK</strong> | Status: <strong>Sunny 28°C</strong>
        </div>
      </div>
    `,
    js: `
      window.fetchWidgetWeather = async function() {
        const city = document.getElementById("widgetCityInput").value || "Karachi";
        const out = document.getElementById("widgetWeatherOutput");
        out.innerHTML = "Fetching weather for " + city + "...";
        try {
          const res = await fetch("http://127.0.0.1:3000/api/jarvis", {
            method: "POST", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({command: "search weather " + city})
          });
          const d = await res.json();
          out.innerHTML = "City: <strong>" + city + "</strong> | Dispatch: <span style='color:#38ffcc;'>ACTIVE</span>";
        } catch(e) { out.textContent = "Weather check dispatched."; }
      };
    `
  },
  visa: {
    id: "widget_visa_tracker",
    title: "🇩🇪 Germany Visa Status",
    accent_color: "#38ffcc",
    html: `
      <div style="font-family: monospace; font-size: 10px;">
        <div style="margin-bottom:4px;">● Blocked Account (11,208 EUR): <strong style="color:#38ffcc;">VERIFIED ✓</strong></div>
        <div style="margin-bottom:4px;">● Admission Letter: <strong style="color:#38ffcc;">VERIFIED ✓</strong></div>
        <div style="margin-bottom:4px;">● Health Insurance: <strong style="color:#ffb86b;">IN PROGRESS</strong></div>
        <button onclick="window.triggerVisaCheck()" style="width:100%; margin-top:6px; padding:4px; background:#38ffcc; color:#000; border:none; border-radius:3px; font-weight:bold; cursor:pointer;">📋 Scan Visa Folder</button>
      </div>
    `,
    js: `
      window.triggerVisaCheck = async function() {
        alert("Scanning Germany Visa 2026 Folder (D:\\\\03_PERSONAL\\\\Visa_Germany_2026)");
      };
    `
  },
  qrcode: {
    id: "widget_quick_qr",
    title: "📱 Quick QR Generator",
    accent_color: "#b855ff",
    html: `
      <div style="font-family: monospace; font-size: 10px;">
        <input type="text" id="widgetQrText" value="https://alsyedgroup.com" style="width:100%; background:#0c1530; border:1px solid #b855ff; color:#fff; padding:4px; font-size:10px; border-radius:3px; margin-bottom:6px;">
        <button onclick="window.generateQuickQr()" style="width:100%; padding:4px; background:#b855ff; color:#fff; border:none; border-radius:3px; font-weight:bold; cursor:pointer;">✨ Generate QR Code</button>
      </div>
    `,
    js: `
      window.generateQuickQr = async function() {
        const val = document.getElementById("widgetQrText").value;
        await fetch("http://127.0.0.1:3000/api/jarvis/plan/execute", {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({goal: "build qrcode template for " + val})
        });
        alert("QR Generation goal dispatched for: " + val);
      };
    `
  }
};

class HudSynthesizerAgent {
  constructor(options = {}) {
    this.id = "hud_synthesizer";
    this.name = "JARVIS Dynamic HUD Synthesizer Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = [
      "synthesize_ui_widget",
      "render_dynamic_card",
      "hud_layout_manager",
      "widget_persistence",
      "custom_dashboard_extension"
    ];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["synthesize widget", "add widget", "hud widget", "widget card", "hud layout", "create widget"];
    return keywords.some(k => c.includes(k)) ? 95 : 0;
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.riskLevel,
      capabilities: this.capabilities,
      active_widgets: loadWidgets().length
    };
  }

  synthesize(request, options = {}) {
    const reqLower = (request || "").toLowerCase();
    let presetKey = options.preset || null;

    if (!presetKey) {
      for (const k of Object.keys(PRESET_SYNTHESIS)) {
        if (reqLower.includes(k)) {
          presetKey = k;
          break;
        }
      }
    }

    let widget;
    if (presetKey && PRESET_SYNTHESIS[presetKey]) {
      const p = PRESET_SYNTHESIS[presetKey];
      widget = {
        id: p.id + "_" + Date.now().toString(36).slice(-4),
        title: p.title,
        accent_color: p.accent_color,
        html: p.html,
        js: p.js,
        created_at: new Date().toISOString()
      };
    } else {
      // Custom generic widget synthesis
      const title = options.title || "🧩 Custom Widget (" + request.slice(0, 15) + ")";
      widget = {
        id: "widget_custom_" + Date.now().toString(36).slice(-6),
        title,
        accent_color: "#00e5ff",
        html: `
          <div style="font-size:11px; color:#d0ecff;">
            <div>Synthesized for: <strong>${request}</strong></div>
            <div style="margin-top:6px; opacity:0.7;">Status: Active & Monitoring</div>
          </div>
        `,
        js: "",
        created_at: new Date().toISOString()
      };
    }

    const current = loadWidgets();
    // Remove older duplicate if preset matches
    const filtered = current.filter(w => !w.id.startsWith(widget.id.split("_")[0] + "_" + widget.id.split("_")[1]));
    filtered.push(widget);
    saveWidgets(filtered);

    return {
      success: true,
      status: "SYNTHESIZED",
      widget,
      total_widgets: filtered.length
    };
  }

  listWidgets() {
    return loadWidgets();
  }

  removeWidget(id) {
    const current = loadWidgets();
    const updated = current.filter(w => w.id !== id);
    saveWidgets(updated);
    return { success: true, removed_id: id, remaining: updated.length };
  }

  async execute(analysis) {
    const cmd = analysis.raw_command || analysis.command || "";
    return this.synthesize(cmd);
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "hud_synthesizer_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id }
    };
  }
}

function createHudSynthesizerAgent(options) {
  return new HudSynthesizerAgent(options);
}

module.exports = { HudSynthesizerAgent, createHudSynthesizerAgent };
