const os = require("os");

function getLocalLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      const family = typeof iface.family === "string" ? iface.family : (iface.family === 4 ? "IPv4" : "");
      if (family === "IPv4" && !iface.internal && iface.address !== "127.0.0.1") {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

class MobileAgent {
  constructor(options = {}) {
    this.id = "mobile";
    this.name = "JARVIS Mobile LAN Remote Control Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = [
      "mobile_remote_control",
      "lan_ip_discovery",
      "pwa_dashboard_provider",
      "cross_platform_continuity",
      "remote_task_dispatch"
    ];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["mobile", "remote control", "phone link", "lan ip", "pwa dashboard", "connect phone"];
    return keywords.some(k => c.includes(k)) ? 95 : 0;
  }

  status() {
    const lanIp = getLocalLanIp();
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.riskLevel,
      capabilities: this.capabilities,
      lan_ip: lanIp,
      mobile_url: `http://${lanIp}:3000/mobile`
    };
  }

  getMobileInfo() {
    const lanIp = getLocalLanIp();
    return {
      success: true,
      lan_ip: lanIp,
      port: 3000,
      mobile_url: `http://${lanIp}:3000/mobile`,
      pwa_endpoint: `http://${lanIp}:3000/mobile.html`,
      instructions: `Open your smartphone browser on the same Wi-Fi network and navigate to: http://${lanIp}:3000/mobile`
    };
  }

  async execute(analysis) {
    return this.getMobileInfo();
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "mobile_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

function createMobileAgent(options) {
  return new MobileAgent(options);
}

module.exports = { MobileAgent, createMobileAgent };
