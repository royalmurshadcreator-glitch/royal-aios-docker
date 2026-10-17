const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");

const ORCH_SRC = path.resolve(__dirname);
const RUNTIME_FILE = path.join(ORCH_SRC, "jarvis-runtime.cjs");
const TEMPLATES_DIR = path.resolve(__dirname, "..", "enhancement-templates");
const AGENTS_PY_DIR = "D:\\01_ROYAL_JARVIS\\Agents";
const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const ENHANCEMENT_HISTORY_FILE = path.resolve(__dirname, "..", "..", "App", "data", "memory", "enhancement-history.jsonl");

// Template registry
const TEMPLATES = {
  whatsapp: {
    name: "WhatsApp Web Automation",
    py_template: "whatsapp-web.py.template",
    py_target_dir: "WhatsApp",
    py_target_name: "WhatsAppAgent.py",
    dependencies: ["pywhatkit", "pyautogui", "pillow"],
    setup_instructions: [
      "First-time only: Chrome will open WhatsApp Web",
      "Scan the QR code with your phone",
      "Session will persist for future messages"
    ],
    capabilities: ["send_whatsapp_message", "send_bulk_whatsapp", "send_whatsapp_image", "whatsapp_web_automation"],
    risk_level: "LEVEL_2"
  },
  email: {
    name: "Gmail SMTP + IMAP",
    py_template: "gmail-smtp.py.template",
    py_target_dir: "Email",
    py_target_name: "EmailAgent.py",
    dependencies: [],
    setup_instructions: [
      "1. Enable 2FA on your Gmail account",
      "2. Generate App Password at myaccount.google.com/apppasswords",
      "3. Create D:\\01_ROYAL_JARVIS\\App\\data\\memory\\gmail-config.json with:",
      "   { \"email\": \"you@gmail.com\", \"app_password\": \"xxxxxxxxxxxxxxxx\" }"
    ],
    capabilities: ["send_email", "read_gmail_inbox", "email_with_attachment", "gmail_automation"],
    risk_level: "LEVEL_2"
  },
  pdf: {
    name: "PDF Generator (reportlab)",
    py_template: "pdf-generator.py.template",
    py_target_dir: "PDF",
    py_target_name: "PdfAgent.py",
    dependencies: ["reportlab"],
    setup_instructions: [
      "Ready to use immediately!",
      "Invoices saved to: D:\\02_ALSYED_BUSINESS\\Documents\\Generated\\"
    ],
    capabilities: ["generate_invoice", "generate_visa_checklist", "generate_report", "professional_pdf"],
    risk_level: "LEVEL_1"
  }
,
  weather: {
    name: "Weather Forecast",
    py_template: "weather.py.template",
    py_target_dir: "Weather",
    py_target_name: "WeatherAgent.py",
    dependencies: ["requests"],
    setup_instructions: ["Get free API key from https://openweathermap.org/api","Set env var OPENWEATHER_API_KEY or edit script directly"],
    capabilities: ["get_current_weather","get_forecast_5day"],
    risk_level: "LEVEL_0"
  }
};

function logEnhancement(entry) {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
    fs.appendFileSync(ENHANCEMENT_HISTORY_FILE, line, "utf-8");
  } catch (_) {}
}

function detectTarget(request) {
  const r = request.toLowerCase();
  for (const key of Object.keys(TEMPLATES)) {
    if (r.includes(key)) return key;
  }
  return null;
}

function installPythonDeps(deps) {
  const results = [];
  for (const pkg of deps) {
    try {
      execSync(`"${PY_EXE}" -m pip install ${pkg} --quiet`, { stdio: "pipe", timeout: 120000 });
      results.push({ package: pkg, status: "installed" });
    } catch (err) {
      results.push({ package: pkg, status: "failed", error: err.message });
    }
  }
  return results;
}

class EnhancerAgent {
  constructor(options = {}) {
    this.id = "enhancer";
    this.name = "JARVIS Meta-Enhancer Agent";
    this.riskLevel = "LEVEL_2";
    this.capabilities = [
      "enhance_existing_agents",
      "install_python_dependencies",
      "deploy_production_code",
      "auto_configure_agents",
      "template_library_manager"
    ];
    this.registry = options.registry || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["enhance agent", "enhance whatsapp", "enhance email", "enhance pdf", "upgrade agent", "make agent real"];
    return keywords.some(k => c.includes(k)) ? 95 : 0;
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.riskLevel,
      capabilities: this.capabilities,
      available_templates: Object.keys(TEMPLATES)
    };
  }

  listTemplates() {
    const templates = {};
    for (const [key, tmpl] of Object.entries(TEMPLATES)) {
      templates[key] = {
        name: tmpl.name,
        dependencies: tmpl.dependencies,
        capabilities: tmpl.capabilities,
        risk_level: tmpl.risk_level
      };
    }
    return templates;
  }

  async enhance(request, options = {}) {
    const result = {
      request,
      started_at: new Date().toISOString(),
      steps: []
    };

    try {
      // PHASE A: Detect Target Template
      const targetKey = options.target || detectTarget(request);
      if (!targetKey || !TEMPLATES[targetKey]) {
        result.status = "FAILED";
        result.error = "No matching template. Available: " + Object.keys(TEMPLATES).join(", ");
        return result;
      }
      
      const template = TEMPLATES[targetKey];
      result.target = targetKey;
      result.template_name = template.name;
      result.steps.push({ phase: "A_detect", status: "OK", message: "Target: " + template.name });

      // PHASE B: Verify template file exists
      const templatePath = path.join(TEMPLATES_DIR, template.py_template);
      if (!fs.existsSync(templatePath)) {
        result.status = "FAILED";
        result.error = "Template file missing: " + templatePath;
        return result;
      }
      result.steps.push({ phase: "B_template", status: "OK", message: "Template loaded" });

      // PHASE C: Install Python Dependencies
      if (template.dependencies.length > 0) {
        result.steps.push({ phase: "C_deps_start", status: "INFO", message: "Installing: " + template.dependencies.join(", ") });
        const depResults = installPythonDeps(template.dependencies);
        result.steps.push({ phase: "C_deps_done", status: "OK", installed: depResults });
      } else {
        result.steps.push({ phase: "C_deps", status: "OK", message: "No dependencies needed" });
      }

      // PHASE D: Deploy Python Code
      const pyTargetDir = path.join(AGENTS_PY_DIR, template.py_target_dir);
      if (!fs.existsSync(pyTargetDir)) {
        fs.mkdirSync(pyTargetDir, { recursive: true });
      }
      const pyTargetPath = path.join(pyTargetDir, template.py_target_name);
      
      // Backup existing if present
      if (fs.existsSync(pyTargetPath)) {
        const backupPath = pyTargetPath + ".backup." + Date.now();
        fs.copyFileSync(pyTargetPath, backupPath);
        result.steps.push({ phase: "D_backup", status: "OK", backup: backupPath });
      }
      
      const pyCode = fs.readFileSync(templatePath, "utf-8");
      fs.writeFileSync(pyTargetPath, pyCode, "utf-8");
      result.steps.push({ phase: "D_deploy_py", status: "OK", path: pyTargetPath });

      // PHASE E: Update .cjs Wrapper with Real Functions
      const wrapperPath = path.join(ORCH_SRC, targetKey + "-agent.cjs");
      const enhancedWrapper = this.buildEnhancedWrapper(targetKey, template, pyTargetPath);
      
      if (fs.existsSync(wrapperPath)) {
        const backupPath = wrapperPath + ".backup." + Date.now();
        fs.copyFileSync(wrapperPath, backupPath);
      }
      fs.writeFileSync(wrapperPath, enhancedWrapper, "utf-8");
      result.steps.push({ phase: "E_wrapper", status: "OK", path: wrapperPath });

      // PHASE F: Syntax check
      try {
        execSync(`node --check "${wrapperPath}"`, { stdio: "pipe" });
        result.steps.push({ phase: "F_syntax", status: "OK" });
      } catch (err) {
        result.status = "FAILED";
        result.error = "Syntax check failed: " + err.message;
        return result;
      }

      // PHASE G: Report
      result.status = "SUCCESS";
      result.setup_instructions = template.setup_instructions;
      result.capabilities_added = template.capabilities;
      result.message = `${template.name} enhancement complete. Restart server to activate.`;
      result.completed_at = new Date().toISOString();
      
      logEnhancement(result);
      return result;

    } catch (err) {
      result.status = "ERROR";
      result.error = err.message;
      logEnhancement(result);
      return result;
    }
  }

  buildEnhancedWrapper(agentId, template, pythonPath) {
    const className = agentId.charAt(0).toUpperCase() + agentId.slice(1) + "Agent";
    const pyPathEscaped = pythonPath.replace(/\\/g, "\\\\");
    const capsJson = JSON.stringify(template.capabilities);
    const keywords = [agentId, ...template.capabilities.map(c => c.split("_")[0])].filter((v,i,a) => a.indexOf(v) === i);
    const keywordsJson = JSON.stringify(keywords);

    return `const { spawn } = require("child_process");
const PY_EXE = "${PY_EXE.replace(/\\/g, "\\\\")}";
const PY_SCRIPT = "${pyPathEscaped}";

class ${className} {
  constructor(options = {}) {
    this.id = "${agentId}";
    this.name = "${template.name} Agent (Enhanced)";
    this.riskLevel = "${template.risk_level}";
    this.capabilities = ${capsJson};
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ${keywordsJson};
    const matches = keywords.filter(k => c.includes(k)).length;
    if (matches >= 2) return 95;
    if (matches === 1) return 80;
    return 0;
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.riskLevel,
      capabilities: this.capabilities,
      enhanced: true
    };
  }

  async execute(analysis) {
    const cmd = (analysis.raw_command || analysis.command || "").toLowerCase();
    const args = this.parseCommand(cmd);
    
    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [PY_SCRIPT, ...args]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());
      
      const timer = setTimeout(() => {
        proc.kill();
        resolve({ success: false, agent: this.id, error: "Timeout", stdout, stderr });
      }, 60000);
      
      proc.on("close", (code) => {
        clearTimeout(timer);
        let parsed = null;
        try { parsed = JSON.parse(stdout.trim()); } catch (_) {}
        
        resolve({
          success: code === 0,
          agent: this.id,
          exit_code: code,
          result: parsed || stdout.trim(),
          error: stderr.trim() || null,
          command_executed: args.join(" ")
        });
      });
    });
  }

  parseCommand(cmd) {
    // Basic parser - override in enhanced versions for specific agents
    const words = cmd.split(/\\s+/);
    return ["default", ...words.slice(1)];
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "${agentId}_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id, enhanced: true }
    };
  }
}

module.exports = { ${className} };
`;
  }

  async execute(analysis) {
    const command = analysis.raw_command || analysis.command || "";
    return await this.enhance(command);
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "enhancer_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id }
    };
  }

  getEnhancementHistory(limit = 20) {
    try {
      if (!fs.existsSync(ENHANCEMENT_HISTORY_FILE)) return [];
      const content = fs.readFileSync(ENHANCEMENT_HISTORY_FILE, "utf-8");
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

function createEnhancerAgent(options) {
  return new EnhancerAgent(options);
}

module.exports = { EnhancerAgent, createEnhancerAgent };

