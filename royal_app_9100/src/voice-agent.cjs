const { spawn } = require("child_process");

function looksLikeVoiceCommand(command) {
  if (typeof command !== "string") return false;
  const c = command.toLowerCase();
  const keywords = ["speak", "say ", "tell me", "voice output", "voice synthesis", "read aloud"];
  return keywords.some(k => c.includes(k));
}

class VoiceAgent {
  constructor(options = {}) {
    this.id = "voice";
    this.name = "Universal Voice Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = [
      "speech_synthesis",
      "tts",
      "voice_feedback",
      "voice_recognition_bridge"
    ];
  }

  canHandle(command, context = {}) {
    if (looksLikeVoiceCommand(command)) return 90;
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
    const textToSpeak = raw.replace(/^(speak|say|tell me|read aloud)\s+/i, "").trim() || raw;
    const cleanText = textToSpeak.replace(/'/g, "").replace(/"/g, "");

    const psCommand = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${cleanText}')`;
    
    return new Promise((resolve) => {
      const proc = spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psCommand]);
      proc.on("close", () => {
        resolve({
          success: true,
          agent: "voice",
          spoken_text: cleanText,
          message: `Voice synthesis completed: "${cleanText}"`
        });
      });
    });
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "voice_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id, analysis }
    };
  }
}

module.exports = {
  VoiceAgent,
  createVoiceAgent: (opts) => new VoiceAgent(opts),
  looksLikeVoiceCommand
};
