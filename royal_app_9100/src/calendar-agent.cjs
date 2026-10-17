class CalendarAgent {
  constructor(options = {}) {
    this.id = "calendar";
    this.name = "Calendar & Scheduling Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = ["schedule_meeting", "add_reminder", "list_appointments", "visa_deadlines"];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["calendar", "schedule", "reminder", "appointment", "meeting", "deadline"];
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
      message: "Calendar schedule updated.",
      command: cmd,
      timestamp: new Date().toISOString()
    };
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "calendar_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id }
    };
  }
}

module.exports = { CalendarAgent };
