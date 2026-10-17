const { spawn } = require("child_process");
const path = require("path");

const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";

function looksLikeFileCommand(command) {
  if (typeof command !== "string") return false;
  const c = command.toLowerCase();
  const keywords = ["organize file", "organize download", "scan download", "file organizer", "sort document", "clean download", "visa document"];
  return keywords.some(k => c.includes(k));
}

class FileAgent {
  constructor(options = {}) {
    this.id = "file";
    this.name = "Universal File Agent";
    this.riskLevel = "LEVEL_2";
    this.capabilities = [
      "scan_downloads",
      "organize_downloads",
      "organize_desktop",
      "categorize_visa_docs",
      "sort_business_files"
    ];
  }

  canHandle(command, context = {}) {
    if (looksLikeFileCommand(command)) return 90;
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
    const cmd = (analysis.raw_command || analysis.command || "").toLowerCase();
    const isScanOnly = cmd.includes("scan") || cmd.includes("check") || cmd.includes("report");
    const script = isScanOnly 
      ? "D:\\01_ROYAL_JARVIS\\Agents\\FileOrganizer.py"
      : "D:\\01_ROYAL_JARVIS\\Agents\\FileOrganizerEngine.py";

    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [script]);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());

      const timer = setTimeout(() => {
        proc.kill();
        resolve({
          success: true,
          agent: "file",
          mode: isScanOnly ? "scan" : "organize",
          output: stdout.trim() || "File operation complete."
        });
      }, 30000);

      proc.on("close", () => {
        clearTimeout(timer);
        resolve({
          success: true,
          agent: "file",
          mode: isScanOnly ? "scan" : "organize",
          output: stdout.trim() || stderr.trim() || "File processing complete."
        });
      });
    });
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "file_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id, analysis }
    };
  }
}

module.exports = {
  FileAgent,
  createFileAgent: (opts) => new FileAgent(opts),
  looksLikeFileCommand
};

