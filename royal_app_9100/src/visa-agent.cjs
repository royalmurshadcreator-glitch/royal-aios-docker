const { spawn } = require("child_process");
const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";

class VisaAgent {
  constructor(options = {}) {
    this.id = "visa";
    this.name = "Visa Agent";
    this.riskLevel = "LEVEL_0";
    this.capabilities = ["document_ops"];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["visa","manages","germany","documents","applications","checklist"];
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
      capabilities: this.capabilities
    };
  }

  async execute(analysis) {
    return new Promise((resolve) => {
      const pyPath = "D:\\01_ROYAL_JARVIS\\Agents\\Visa\\VisaAgent.py";
      const proc = spawn(PY_EXE, [pyPath]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());
      const timer = setTimeout(() => {
        proc.kill();
        resolve({ success: true, agent: this.id, output: stdout.trim() || "Timeout after 30s", request: analysis.raw_command });
      }, 30000);
      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0,
          agent: this.id,
          exit_code: code,
          output: stdout.trim() || stderr.trim() || "Executed",
          request: analysis.raw_command,
          python_script: "D:\\01_ROYAL_JARVIS\\Agents\\Visa\\VisaAgent.py"
        });
      });
    });
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "visa_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id }
    };
  }
}

module.exports = { VisaAgent };

