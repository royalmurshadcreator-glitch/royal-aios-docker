const { spawn } = require("child_process");
const path = require("path");

const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const BRIDGE_SCRIPT = "D:\\01_ROYAL_JARVIS\\Voice\\jarvis-voice-bridge.py";

class VoiceLoop {
  constructor() {
    this.process = null;
    this.startedAt = null;
    this.status = "STOPPED";
    this.lastError = null;
  }

  start() {
    if (this.process) {
      return { ok: true, message: "Already running", status: this.status };
    }
    try {
      this.process = spawn(PY_EXE, [BRIDGE_SCRIPT], {
        cwd: "D:\\01_ROYAL_JARVIS\\Voice",
        windowsHide: true
      });
      this.startedAt = new Date().toISOString();
      this.status = "RUNNING";
      this.lastError = null;

      this.process.stdout.on("data", (d) => {
        console.log(`[VOICE-LOOP] ${d.toString().trim()}`);
      });
      this.process.stderr.on("data", (d) => {
        console.error(`[VOICE-LOOP-ERR] ${d.toString().trim()}`);
      });
      this.process.on("exit", (code) => {
        console.log(`[VOICE-LOOP] Exited with code ${code}`);
        this.status = "STOPPED";
        this.process = null;
      });

      return { ok: true, status: "RUNNING", pid: this.process.pid, started_at: this.startedAt };
    } catch (err) {
      this.lastError = err.message;
      this.status = "ERROR";
      return { ok: false, error: err.message };
    }
  }

  stop() {
    if (!this.process) {
      return { ok: true, message: "Not running", status: "STOPPED" };
    }
    try {
      this.process.kill();
      this.status = "STOPPED";
      this.process = null;
      return { ok: true, status: "STOPPED" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  getStatus() {
    return {
      status: this.status,
      pid: this.process ? this.process.pid : null,
      started_at: this.startedAt,
      last_error: this.lastError
    };
  }
}

function createVoiceLoop() {
  return new VoiceLoop();
}

module.exports = { VoiceLoop, createVoiceLoop };

