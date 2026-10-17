const { spawn } = require("child_process");
const path = require("path");

const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const IMG_SCRIPT = "D:\\01_ROYAL_JARVIS\\Agents\\Specialized\\ImageGenEngine.py";
const VID_SCRIPT = "D:\\01_ROYAL_JARVIS\\Agents\\Specialized\\VideoGenEngine.py";

class MediaGenAgent {
  constructor(options = {}) {
    this.id = "media_gen";
    this.name = "JARVIS Local Image & Video Generator Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = [
      "generate_image",
      "edit_picture",
      "generate_video",
      "tiktok_reel_creator",
      "downloadable_media_artifacts"
    ];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["generate image", "create picture", "make photo", "edit picture", "generate video", "make reel", "create video"];
    return keywords.some(k => c.includes(k)) ? 95 : 0;
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
    const isVideo = cmd.includes("video") || cmd.includes("reel") || cmd.includes("tiktok");
    const script = isVideo ? VID_SCRIPT : IMG_SCRIPT;

    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [script, cmd]);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());

      const timer = setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: "Media generation timeout" });
      }, 30000);

      proc.on("close", (code) => {
        clearTimeout(timer);
        try {
          const resData = JSON.parse(stdout.trim());
          resolve({
            success: code === 0 && resData.status === "SUCCESS",
            agent: this.id,
            media: resData
          });
        } catch (_) {
          resolve({ success: false, error: stderr.trim() || stdout.trim() });
        }
      });
    });
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "media_gen_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

function createMediaGenAgent(options) {
  return new MediaGenAgent(options);
}

module.exports = { MediaGenAgent, createMediaGenAgent };

