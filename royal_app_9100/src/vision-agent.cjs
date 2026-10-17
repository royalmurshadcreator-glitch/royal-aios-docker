function looksLikeVisionCommand(command) {
  if (typeof command !== "string") return false;
  const c = command.toLowerCase();
  const keywords = ["camera", "vision", "gesture", "hand gesture", "vision sensor", "see screen"];
  return keywords.some(k => c.includes(k));
}

class VisionAgent {
  constructor(options = {}) {
    this.id = "vision";
    this.name = "Universal Vision Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = [
      "camera_sensors",
      "gesture_recognition",
      "hand_tracking",
      "visual_trigger"
    ];
  }

  canHandle(command, context = {}) {
    if (looksLikeVisionCommand(command)) return 90;
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
    const raw = analysis.raw_command || analysis.command || "";
    return {
      success: true,
      agent: "vision",
      command: raw,
      status: "Vision sensor stack ready.",
      capabilities: this.capabilities
    };
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "vision_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id, analysis }
    };
  }
}

module.exports = {
  VisionAgent,
  createVisionAgent: (opts) => new VisionAgent(opts),
  looksLikeVisionCommand
};
