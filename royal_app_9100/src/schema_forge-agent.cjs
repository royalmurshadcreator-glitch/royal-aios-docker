const { spawn } = require("child_process");
const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const PY_SCRIPT = "D:\\01_ROYAL_JARVIS\\Agents\\Specialized\\Schema_forgeAgent.py";

class Schema_forgeAgent {
  constructor(options = {}) {
    this.id = "schema_forge";
    this.name = "JARVIS Schema_forge Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = ["schema_forge_execution", "full_stack_action"];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    return c.includes("schema_forge") ? 90 : 0;
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
    const cmd = analysis.raw_command || analysis.command || "";
    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [PY_SCRIPT, cmd]);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());
      const timer = setTimeout(() => { proc.kill(); resolve({ success: true, output: stdout || "Timeout" }); }, 15000);
      proc.on("close", (code) => {
        clearTimeout(timer);
        try { resolve({ success: code === 0, agent: this.id, result: JSON.parse(stdout.trim()) }); }
        catch (_) { resolve({ success: code === 0, agent: this.id, output: stdout.trim() || stderr.trim() }); }
      });
    });
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "schema_forge_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

module.exports = { Schema_forgeAgent };
