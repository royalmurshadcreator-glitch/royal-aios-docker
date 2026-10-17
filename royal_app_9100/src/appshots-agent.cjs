const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const MODEL = "qwen2.5:3b";
const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const PY_SCRIPT = "D:\\01_ROYAL_JARVIS\\Agents\\Specialized\\AppshotsAgent.py";

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 300 }
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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Ollama timeout")); });
    req.write(body);
    req.end();
  });
}

class AppshotsAgent {
  constructor(options = {}) {
    this.id = "appshots";
    this.name = "Appshots Active Window Vision Agent";
    this.riskLevel = "LEVEL_0";
    this.capabilities = [
      "capture_active_window",
      "screen_critique",
      "appshot_analysis",
      "window_context_awareness"
    ];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["appshot", "screenshot", "screen vision", "active window", "look at screen", "see my screen"];
    return keywords.some(k => c.includes(k)) ? 90 : 0;
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.riskLevel,
      capabilities: this.capabilities
    };
  }

  captureScreen() {
    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [PY_SCRIPT]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());

      const timer = setTimeout(() => {
        proc.kill();
        resolve({ status: "FAILED", error: "Screen capture timeout" });
      }, 15000);

      proc.on("close", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (_) {
          resolve({ status: "FAILED", error: stderr.trim() || stdout.trim() });
        }
      });
    });
  }

  async execute(analysis) {
    const cmd = analysis.raw_command || analysis.command || "";
    const cap = await this.captureScreen();
    if (cap.status !== "SUCCESS") {
      return { success: false, agent: this.id, error: cap.error || "Capture failed" };
    }

    const title = cap.active_window_title || "Active Program";
    const prompt = `You are JARVIS Appshots Vision. The active window focus is "${title}".
User request: "${cmd || "Analyze active screen"}"
Provide a 2-sentence executive summary/critique of this program focus and next AI automation step for Boss.`;

    let critique = "";
    try {
      critique = (await callOllama(prompt)).trim();
    } catch (_) {
      critique = `Active window detected: ${title}. System ready for automated tasks.`;
    }

    return {
      success: true,
      agent: this.id,
      active_window_title: title,
      filename: cap.filename,
      screenshot_url: "/api/artifacts/appshot_latest.png",
      critique,
      timestamp: cap.timestamp
    };
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "appshots_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

module.exports = { AppshotsAgent, createAppshotsAgent: (options) => new AppshotsAgent(options) };


