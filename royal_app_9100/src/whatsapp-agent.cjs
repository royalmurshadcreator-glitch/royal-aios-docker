const { spawn } = require("child_process");
const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const PY_SCRIPT = "D:\\01_ROYAL_JARVIS\\Agents\\WhatsApp\\WhatsAppAgent.py";

class WhatsappAgent {
  constructor(options = {}) {
    this.id = "whatsapp";
    this.name = "WhatsApp Web Automation Agent (Enhanced)";
    this.riskLevel = "LEVEL_2";
    this.capabilities = ["send_whatsapp_message","send_bulk_whatsapp","send_whatsapp_image","whatsapp_web_automation"];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["whatsapp","send"];
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
    const words = cmd.split(/\s+/);
    return ["default", ...words.slice(1)];
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "whatsapp_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id, enhanced: true }
    };
  }
}

module.exports = { WhatsappAgent };

