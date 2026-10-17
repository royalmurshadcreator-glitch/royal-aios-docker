const os = require("os");

function looksLikeSystemCommand(command) {
  if (typeof command !== "string") return false;
  const c = command.toLowerCase();
  const keywords = ["system status", "cpu", "ram", "memory usage", "disk space", "os info", "uptime", "system health"];
  return keywords.some(k => c.includes(k));
}

class SystemAgent {
  constructor(options = {}) {
    this.id = "system";
    this.name = "Universal System Agent";
    this.riskLevel = "LEVEL_0";
    this.capabilities = [
      "cpu_metrics",
      "ram_metrics",
      "os_metrics",
      "uptime_check",
      "system_diagnostics"
    ];
  }

  canHandle(command, context = {}) {
    if (looksLikeSystemCommand(command)) return 95;
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
    const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
    const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
    const usedMem = (totalMem - freeMem).toFixed(2);
    const memUsagePct = ((usedMem / totalMem) * 100).toFixed(1);

    const metrics = {
      platform: os.platform(),
      release: os.release(),
      hostname: os.hostname(),
      uptime_hours: (os.uptime() / 3600).toFixed(2),
      cpu_count: os.cpus().length,
      cpu_model: os.cpus()[0] ? os.cpus()[0].model : "Unknown",
      total_ram_gb: `${totalMem} GB`,
      free_ram_gb: `${freeMem} GB`,
      used_ram_gb: `${usedMem} GB`,
      ram_usage_percent: `${memUsagePct}%`
    };

    return {
      success: true,
      agent: "system",
      metrics,
      summary: `System ${metrics.hostname} (${metrics.platform}) | RAM: ${metrics.ram_usage_percent} | CPUs: ${metrics.cpu_count} | Uptime: ${metrics.uptime_hours} hrs`
    };
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "system_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id, analysis }
    };
  }
}

module.exports = {
  SystemAgent,
  createSystemAgent: (opts) => new SystemAgent(opts),
  looksLikeSystemCommand
};
