const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const MODEL = "qwen2.5:3b";
const ORCH_SRC = path.resolve(__dirname);
const RUNTIME_FILE = path.join(ORCH_SRC, "jarvis-runtime.cjs");
const AGENTS_PY_DIR = "D:\\01_ROYAL_JARVIS\\Agents";
const BUILD_HISTORY_FILE = path.resolve(__dirname, "..", "..", "App", "data", "memory", "builder-history.jsonl");
const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";

// V2.1: COMPACT & FOCUSED PROMPT (faster LLM response)
const AGENT_PROMPT_COMPACT = `Generate a Node.js .cjs agent module. Return ONLY the raw JavaScript code (no markdown, no explanation).

REQUIRED STRUCTURE:
- class {ClassName}Agent with constructor(options={})
- constructor sets: this.id, this.name, this.riskLevel, this.capabilities (array of 3-5 strings), this.orchestrator
- canHandle(command) returns 0-100 based on keyword matching
- status() returns object with id, name, online, risk_level, capabilities
- async execute(analysis) does the actual work
- async createTask(analysis) returns task metadata
- module.exports = { {ClassName}Agent }

If a Python script is provided, integrate it via spawn from child_process.

GENERATE FOR:`;

function callOllama(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.15, num_predict: 1500 }
    });

    const req = http.request(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data).response || ""); }
        catch (e) { reject(e); }
      });
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs || 300000, () => {
      req.destroy();
      reject(new Error("Ollama timeout after " + (timeoutMs || 300000) + "ms"));
    });
    req.write(body);
    req.end();
  });
}

function cleanCode(text) {
  if (!text) return "";
  return text.replace(/```javascript\s*/gi, "").replace(/```js\s*/gi, "").replace(/```\s*/g, "").trim();
}

function logBuild(entry) {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
    fs.appendFileSync(BUILD_HISTORY_FILE, line, "utf-8");
  } catch (_) {}
}

// V2.1: IMPROVED RECURSIVE PYTHON SCRIPT FINDER
function walkPythonScripts(dir, depth) {
  if (depth > 3) return [];
  const results = [];
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; }
      
      if (stat.isDirectory()) {
        // Skip venv and hidden folders
        if (item.includes("venv") || item.startsWith(".") || item.includes("node_modules") || item.includes("site-packages")) continue;
        results.push(...walkPythonScripts(full, depth + 1));
      } else if (item.endsWith(".py") && !item.includes("OLD") && !item.startsWith("_") && !item.includes("test")) {
        results.push(full);
      }
    }
  } catch (_) {}
  return results;
}

function findRelevantPythonScript(agentName) {
  if (!fs.existsSync(AGENTS_PY_DIR)) return null;
  const allScripts = walkPythonScripts(AGENTS_PY_DIR, 0);
  const nameLower = agentName.toLowerCase();
  
  // Strategy 1: Filename contains agent name (e.g., "WhatsAppAgent.py" for "whatsapp")
  for (const scriptPath of allScripts) {
    const base = path.basename(scriptPath).toLowerCase().replace(".py", "");
    if (base.includes(nameLower)) {
      return scriptPath;
    }
  }
  
  // Strategy 2: Folder path contains agent name (e.g., "Agents\WhatsApp\WhatsAppAgent.py")
  for (const scriptPath of allScripts) {
    if (scriptPath.toLowerCase().includes(nameLower)) {
      return scriptPath;
    }
  }
  
  return null;
}

class BuilderAgent {
  constructor(options = {}) {
    this.id = "builder";
    this.name = "JARVIS Meta-Builder v2.1 (Hotfixed)";
    this.riskLevel = "LEVEL_2";
    this.capabilities = [
      "generate_production_agents",
      "auto_python_integration",
      "recursive_script_discovery",
      "smart_risk_detection",
      "self_extension"
    ];
    this.registry = options.registry || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["build agent", "create agent", "make agent", "new agent", "generate agent", "add agent"];
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

  extractAgentName(request) {
    const patterns = [
      /(?:build|create|make|generate|add)\s+(?:a\s+|an\s+)?(?:new\s+)?(\w+)\s+(?:automation\s+|management\s+|integration\s+)?agent/i,
      /(\w+)\s+agent/i
    ];
    for (const p of patterns) {
      const m = request.match(p);
      if (m && m[1]) return m[1].toLowerCase().replace(/[^a-z0-9]/g, "");
    }
    return "custom" + Date.now().toString(36).slice(-4);
  }

  toPascalCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  determineRiskLevel(request) {
    const c = request.toLowerCase();
    if (c.includes("delete") || c.includes("format") || c.includes("shutdown") || c.includes("payment")) return "LEVEL_3";
    if (c.includes("send") || c.includes("write") || c.includes("modify") || c.includes("organize") || c.includes("email") || c.includes("whatsapp")) return "LEVEL_2";
    if (c.includes("open") || c.includes("launch") || c.includes("speak")) return "LEVEL_1";
    return "LEVEL_0";
  }

  async build(request, options = {}) {
    const result = {
      request,
      started_at: new Date().toISOString(),
      steps: []
    };

    try {
      const agentName = this.extractAgentName(request);
      const className = this.toPascalCase(agentName);
      const fileName = agentName + "-agent.cjs";
      const filePath = path.join(ORCH_SRC, fileName);
      const detectedRisk = this.determineRiskLevel(request);

      result.agent_name = agentName;
      result.class_name = className + "Agent";
      result.file_path = filePath;
      result.detected_risk_level = detectedRisk;

      result.steps.push({ phase: "A_analyze", status: "OK", message: "Target: " + fileName + " | Risk: " + detectedRisk });

      if (fs.existsSync(filePath) && !options.overwrite) {
        result.status = "SKIPPED";
        result.message = "Agent " + agentName + " already exists. Use overwrite=true.";
        logBuild(result);
        return result;
      }

      // PHASE B: RECURSIVE PYTHON DISCOVERY
      const matchedPython = findRelevantPythonScript(agentName);
      if (matchedPython) {
        result.steps.push({ phase: "B_discovery", status: "OK", python_script: matchedPython, message: "Found: " + path.basename(matchedPython) });
      } else {
        result.steps.push({ phase: "B_discovery", status: "OK", message: "No Python script matched (will use pure JS)" });
      }

      // PHASE C: LLM Generation with STRATEGY based on Python match
      let useFallback = false;
      let generatedCode = "";

      // For SPEED: If Python script is matched, skip LLM and use production template directly
      // This is faster AND more reliable than waiting for slow LLM output
      if (matchedPython) {
        generatedCode = this.buildProductionTemplate(agentName, className, request, matchedPython, detectedRisk);
        result.steps.push({ phase: "C_generation", status: "OK_TEMPLATE", message: "Used production template with Python integration (faster than LLM)" });
      } else {
        // No Python match - generate instant standalone JS agent directly
        try {
          const prompt = AGENT_PROMPT_COMPACT + "\nRequest: \"" + request + "\"\nClass: " + className + "Agent\nID: " + agentName + "\nRisk: " + detectedRisk;
          generatedCode = await callOllama(prompt, 180000);
          generatedCode = cleanCode(generatedCode);
          
          // Validate
          const required = [className + "Agent", "module.exports", "canHandle", "execute"];
          const missing = required.filter(p => !generatedCode.includes(p));
          
          if (missing.length > 0 || generatedCode.length < 400) {
            useFallback = true;
          }
        } catch (llmErr) {
          result.steps.push({ phase: "C_generation", status: "LLM_TIMEOUT", message: llmErr.message + " (using template)" });
          useFallback = true;
        }
        
        if (useFallback) {
          generatedCode = this.buildProductionTemplate(agentName, className, request, null, detectedRisk);
          result.steps.push({ phase: "C_generation", status: "OK_TEMPLATE", message: "LLM fallback - used template" });
        } else {
          result.steps.push({ phase: "C_generation", status: "OK_LLM", size: generatedCode.length });
        }
      }

      if (options.preview_only) {
        result.status = "PREVIEW";
        result.generated_code = generatedCode;
        result.python_integrated = matchedPython ? true : false;
        result.message = "Preview mode - not deployed.";
        logBuild(result);
        return result;
      }

      // PHASE E: Write
      fs.writeFileSync(filePath, generatedCode, "utf-8");
      result.steps.push({ phase: "E_write", status: "OK", size: generatedCode.length });

      // PHASE F: Syntax
      try {
        execSync("node --check \"" + filePath + "\"", { stdio: "pipe" });
        result.steps.push({ phase: "F_syntax", status: "OK" });
      } catch (err) {
        fs.unlinkSync(filePath);
        result.status = "FAILED";
        result.error = "Syntax check failed";
        result.steps.push({ phase: "F_syntax", status: "FAILED" });
        logBuild(result);
        return result;
      }

      // PHASE G: Registration
      let runtimeCode = fs.readFileSync(RUNTIME_FILE, "utf-8");
      const requireLine = "const { " + className + "Agent } = require(\"./" + fileName + "\");";
      const registerLine = "  registry.register(new " + className + "Agent({ orchestrator }));";

      if (!runtimeCode.includes(requireLine)) {
        const lastRequireMatch = runtimeCode.match(/const \{ VisionAgent \} = require\("\.\/vision-agent\.cjs"\);/);
        if (lastRequireMatch) {
          runtimeCode = runtimeCode.replace(lastRequireMatch[0], lastRequireMatch[0] + "\n" + requireLine);
        }
        const registerBlock = runtimeCode.match(/registry\.register\(new VisionAgent\([^)]*\)\);/);
        if (registerBlock) {
          runtimeCode = runtimeCode.replace(registerBlock[0], registerBlock[0] + "\n" + registerLine);
        }
        fs.writeFileSync(RUNTIME_FILE, runtimeCode, "utf-8");
        result.steps.push({ phase: "G_registration", status: "OK" });
      } else {
        result.steps.push({ phase: "G_registration", status: "SKIPPED" });
      }

      result.status = "SUCCESS";
      result.message = "Agent '" + agentName + "' built. Restart server to activate.";
      result.python_integrated = matchedPython ? true : false;
      result.completed_at = new Date().toISOString();
      logBuild(result);
      return result;

    } catch (err) {
      result.status = "ERROR";
      result.error = err.message;
      result.steps.push({ phase: "ERROR", status: "FAILED", message: err.message });
      logBuild(result);
      return result;
    }
  }

  buildProductionTemplate(agentName, className, request, pythonScript, riskLevel) {
    const capabilities = this.generateCapabilities(agentName, request);
    const keywords = this.generateKeywords(agentName, request);
    
    let executeBody;
    if (pythonScript) {
      const pyPathEscaped = pythonScript.replace(/\\/g, "\\\\");
      executeBody = "\n    return new Promise((resolve) => {\n" +
        "      const pyPath = \"" + pyPathEscaped + "\";\n" +
        "      const proc = spawn(PY_EXE, [pyPath]);\n" +
        "      let stdout = \"\";\n" +
        "      let stderr = \"\";\n" +
        "      proc.stdout.on(\"data\", d => stdout += d.toString());\n" +
        "      proc.stderr.on(\"data\", d => stderr += d.toString());\n" +
        "      const timer = setTimeout(() => {\n" +
        "        proc.kill();\n" +
        "        resolve({ success: true, agent: this.id, output: stdout.trim() || \"Timeout after 30s\", request: analysis.raw_command });\n" +
        "      }, 30000);\n" +
        "      proc.on(\"close\", (code) => {\n" +
        "        clearTimeout(timer);\n" +
        "        resolve({\n" +
        "          success: code === 0,\n" +
        "          agent: this.id,\n" +
        "          exit_code: code,\n" +
        "          output: stdout.trim() || stderr.trim() || \"Executed\",\n" +
        "          request: analysis.raw_command,\n" +
        "          python_script: \"" + pyPathEscaped + "\"\n" +
        "        });\n" +
        "      });\n" +
        "    });";
    } else {
      executeBody = "\n    return {\n" +
        "      success: true,\n" +
        "      agent: this.id,\n" +
        "      message: \"" + className + " Agent executed\",\n" +
        "      request: analysis.raw_command || analysis.command,\n" +
        "      note: \"This agent has no Python backend. Customize execute() for real functionality.\"\n" +
        "    };";
    }

    return "const { spawn } = require(\"child_process\");\n" +
      "const PY_EXE = \"" + PY_EXE.replace(/\\/g, "\\\\") + "\";\n\n" +
      "class " + className + "Agent {\n" +
      "  constructor(options = {}) {\n" +
      "    this.id = \"" + agentName + "\";\n" +
      "    this.name = \"" + className + " Agent\";\n" +
      "    this.riskLevel = \"" + riskLevel + "\";\n" +
      "    this.capabilities = " + JSON.stringify(capabilities) + ";\n" +
      "    this.orchestrator = options.orchestrator || null;\n" +
      "  }\n\n" +
      "  canHandle(command) {\n" +
      "    if (typeof command !== \"string\") return 0;\n" +
      "    const c = command.toLowerCase();\n" +
      "    const keywords = " + JSON.stringify(keywords) + ";\n" +
      "    const matches = keywords.filter(k => c.includes(k)).length;\n" +
      "    if (matches >= 2) return 95;\n" +
      "    if (matches === 1) return 80;\n" +
      "    return 0;\n" +
      "  }\n\n" +
      "  status() {\n" +
      "    return {\n" +
      "      id: this.id,\n" +
      "      name: this.name,\n" +
      "      online: true,\n" +
      "      risk_level: this.riskLevel,\n" +
      "      capabilities: this.capabilities\n" +
      "    };\n" +
      "  }\n\n" +
      "  async execute(analysis) {" + executeBody + "\n" +
      "  }\n\n" +
      "  async createTask(analysis) {\n" +
      "    return {\n" +
      "      command: analysis.raw_command || analysis.command,\n" +
      "      source: \"" + agentName + "_agent\",\n" +
      "      risk_level: this.riskLevel,\n" +
      "      metadata: { agent_id: this.id }\n" +
      "    };\n" +
      "  }\n" +
      "}\n\n" +
      "module.exports = { " + className + "Agent };\n";
  }

  generateCapabilities(agentName, request) {
    const req = request.toLowerCase();
    const caps = [];
    if (req.includes("send")) caps.push(agentName + "_send");
    if (req.includes("read") || req.includes("receive")) caps.push(agentName + "_read");
    if (req.includes("reply")) caps.push("auto_reply");
    if (req.includes("schedule") || req.includes("calendar")) caps.push("scheduling");
    if (req.includes("organize") || req.includes("sort")) caps.push("organization");
    if (req.includes("generate") || req.includes("create")) caps.push("content_generation");
    if (req.includes("email")) caps.push("email_ops");
    if (req.includes("message") || req.includes("whatsapp")) caps.push("messaging");
    if (req.includes("pdf") || req.includes("document")) caps.push("document_ops");
    if (caps.length === 0) caps.push(agentName + "_action", "custom_workflow");
    return caps.slice(0, 5);
  }

  generateKeywords(agentName, request) {
    const kw = [agentName];
    const req = request.toLowerCase();
    const words = req.split(/\s+/).filter(w => w.length > 3 && !["build", "agent", "that", "with", "from", "this", "the", "and", "for"].includes(w));
    words.slice(0, 8).forEach(w => { if (!kw.includes(w)) kw.push(w); });
    return kw.slice(0, 8);
  }

  async execute(analysis) {
    const command = analysis.raw_command || analysis.command || "";
    return await this.build(command);
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "builder_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id }
    };
  }

  getBuildHistory(limit = 20) {
    try {
      if (!fs.existsSync(BUILD_HISTORY_FILE)) return [];
      const content = fs.readFileSync(BUILD_HISTORY_FILE, "utf-8");
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

function createBuilderAgent(options) {
  return new BuilderAgent(options);
}

module.exports = { BuilderAgent, createBuilderAgent };


