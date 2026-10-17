const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const MODEL = "qwen2.5:3b";
const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const CODEX_DIR = path.resolve(__dirname, "..", "..", "App", "data", "codex");
const CHARTS_DIR = "D:\\02_ALSYED_BUSINESS\\Documents\\Generated";

function ensureDirs() {
  if (!fs.existsSync(CODEX_DIR)) fs.mkdirSync(CODEX_DIR, { recursive: true });
  if (!fs.existsSync(CHARTS_DIR)) fs.mkdirSync(CHARTS_DIR, { recursive: true });
}

function callOllama(prompt, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 500 }
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
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Ollama timeout")); });
    req.write(body);
    req.end();
  });
}

function cleanPythonCode(text) {
  if (!text) return "";
  let clean = text.replace(/```python\s*/gi, "").replace(/```py\s*/gi, "").replace(/```\s*/g, "").trim();
  return clean;
}

class CodexAgent {
  constructor(options = {}) {
    this.id = "codex";
    this.name = "JARVIS Codex / Code Interpreter Agent";
    this.riskLevel = "LEVEL_2";
    this.capabilities = [
      "code_interpreter",
      "self_debugging_loop",
      "data_analysis",
      "chart_plotting",
      "python_execution",
      "script_auto_patching"
    ];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = [
      "code interpreter", "run python", "execute python", "debug script",
      "plot chart", "data analysis", "run code", "analyze csv", "matplotlib"
    ];
    return keywords.some(k => c.includes(k)) ? 95 : 0;
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

  runPythonFile(scriptPath) {
    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [scriptPath]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());
      
      const timer = setTimeout(() => {
        proc.kill();
        resolve({ code: -1, stdout: stdout.trim(), stderr: "Execution timed out after 45s" });
      }, 45000);

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }

  async interpreterLoop(taskPrompt, options = {}) {
    ensureDirs();
    const executionHistory = [];
    const maxRetries = options.max_retries || 3;
    const timestamp = Date.now();
    const scriptPath = path.join(CODEX_DIR, `exec_${timestamp}.py`);

    const systemPrompt = `You are the JARVIS Codex Interpreter. Write a self-contained, complete Python script for the user's task.
RULES:
1. Return ONLY raw, executable Python code. No markdown fences. No explanation.
2. Ensure imports are standard or common (matplotlib, pandas, numpy, os, sys, json).
3. If saving charts/images, save to: D:\\02_ALSYED_BUSINESS\\Documents\\Generated\\
4. Print all results/summaries clearly to stdout using print().

Task: ${taskPrompt}`;

    let currentCode = "";
    try {
      const rawLlm = await callOllama(systemPrompt);
      currentCode = cleanPythonCode(rawLlm);
    } catch (err) {
      return { success: false, error: "Failed to generate initial code: " + err.message };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      fs.writeFileSync(scriptPath, currentCode, "utf-8");
      const execRes = await this.runPythonFile(scriptPath);
      
      executionHistory.push({
        attempt,
        code: currentCode,
        stdout: execRes.stdout,
        stderr: execRes.stderr,
        exit_code: execRes.code
      });

      if (execRes.code === 0) {
        return {
          success: true,
          agent: this.id,
          attempts: attempt,
          stdout: execRes.stdout,
          script_path: scriptPath,
          execution_history: executionHistory
        };
      }

      if (attempt < maxRetries) {
        const patchPrompt = `The following Python script failed with an error. Fix the bug and return the complete, working Python script.
NO MARKDOWN. NO EXPLANATION. ONLY WORKING PYTHON CODE.

BROKEN CODE:
${currentCode}

ERROR / STACKTRACE:
${execRes.stderr}

FIXED PYTHON CODE:`;

        try {
          const patchedLlm = await callOllama(patchPrompt);
          currentCode = cleanPythonCode(patchedLlm);
        } catch (patchErr) {
          break;
        }
      }
    }

    return {
      success: false,
      agent: this.id,
      error: "Code execution failed after " + maxRetries + " self-debugging attempts.",
      last_stderr: executionHistory[executionHistory.length - 1]?.stderr || "Unknown error",
      execution_history: executionHistory
    };
  }

  async execute(analysis) {
    const cmd = analysis.raw_command || analysis.command || "";
    return await this.interpreterLoop(cmd);
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "codex_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id }
    };
  }
}

function createCodexAgent(options) {
  return new CodexAgent(options);
}

module.exports = { CodexAgent, createCodexAgent };


