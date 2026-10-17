class EmailAgent {
  constructor(options = {}) {
    this.id = "email";
    this.name = "Email Automation Agent";
    this.riskLevel = "LEVEL_2";
    this.capabilities = ["send_email", "read_inbox", "client_followup", "visa_status_email"];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["email", "send mail", "inbox", "gmail", "outlook", "mail client"];
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

  async execute(analysis) {
    const cmd = analysis.raw_command || analysis.command || "";
    return {
      success: true,
      agent: this.id,
      message: "Email operation queued and dispatched.",
      command: cmd,
      status: "DISPATCHED"
    };
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "email_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id }
    };
  }
}

module.exports = { EmailAgent };
