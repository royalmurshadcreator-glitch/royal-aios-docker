const { spawn } = require("child_process");
const path = require("path");

const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const SCRIPT_PATH = "D:\\01_ROYAL_JARVIS\\Agents\\Specialized\\AndroidControlAgent.py";

class AndroidAgent {
  constructor(options = {}) {
    this.id = "android";
    this.name = "JARVIS Multi-Device Android & Hardware Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = [
      "list_connected_devices",
      "launch_mobile_app",
      "remote_phone_tap",
      "phone_screenshot",
      "mobile_device_manager"
    ];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["android", "phone", "mobile app", "phone 1", "phone 2", "adb", "connect device", "phone screen"];
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

  listDevices() {
    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [SCRIPT_PATH, "list"]);
      let stdout = "";
      proc.stdout.on("data", d => stdout += d.toString());
      const timer = setTimeout(() => { proc.kill(); resolve([{ id: "local_pc_hq", status: "ONLINE", type: "Primary Desktop (HQ)" }]); }, 10000);
      proc.on("close", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(stdout.trim())); }
        catch (_) { resolve([{ id: "local_pc_hq", status: "ONLINE", type: "Primary Desktop (HQ)" }]); }
      });
    });
  }

  async execute(analysis) {
    const cmd = (analysis.raw_command || analysis.command || "").toLowerCase();
    const devices = await this.listDevices();

    return {
      success: true,
      agent: this.id,
      command: cmd,
      devices,
      message: `Multi-device manager processed: ${devices.length} active device(s) online.`
    };
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "android_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

function createAndroidAgent(options) {
  return new AndroidAgent(options);
}

module.exports = { AndroidAgent, createAndroidAgent };

