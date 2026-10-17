"use strict";

/*
 * ROYAL JARVIS — Universal Computer Agent
 *
 * This is the controlled JARVIS interface to the existing
 * UniversalExecutor.py.
 *
 * It does NOT directly manipulate Windows.
 * It sends commands through the existing Arena Gateway,
 * preserving the Phase 1 Orchestrator/security path.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

const PYTHON =
  process.env.ROYAL_JARVIS_PYTHON ||
  "D:\\\\01_ROYAL_JARVIS\\\\.venv\\\\Scripts\\\\python.exe";

const GATEWAY =
  process.env.ROYAL_JARVIS_GATEWAY ||
  path.join(ROOT, "Autopilot", "RoyalArenaGateway.py");

const WINDOWS_APP_PATTERNS = [
  /\bopen\s+(notepad|calculator|calc|paint|explorer|file explorer|cmd|command prompt|powershell|terminal)\b/i,
  /\blaunch\s+(notepad|calculator|calc|paint|explorer|file explorer|cmd|command prompt|powershell|terminal)\b/i,
  /\bstart\s+(notepad|calculator|calc|paint|explorer|file explorer|cmd|command prompt|powershell|terminal)\b/i,
  /\btype\b/i,
  /\bclick\b/i,
  /\bpress\b/i,
  /\bkeyboard\b/i,
  /\bmouse\b/i,
  /\bwindow\b/i,
  /\bswitch\s+to\b/i,
  /\bclose\s+(notepad|calculator|calc|paint|explorer|terminal|powershell)\b/i
];

function looksLikeComputerCommand(command) {
  return WINDOWS_APP_PATTERNS.some(rx => rx.test(command));
}

function runGateway(command, timeoutMs = 120000) {

  return new Promise((resolve, reject) => {

    const child = spawn(
      PYTHON,
      [GATEWAY, command],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {

      if (finished) return;

      finished = true;

      try {
        child.kill();
      } catch (_) {}

      const err = new Error(
        `Computer Agent timed out after ${timeoutMs}ms.`
      );

      err.code = "COMPUTER_AGENT_TIMEOUT";

      reject(err);

    }, timeoutMs);

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    child.on("error", err => {

      if (finished) return;

      finished = true;
      clearTimeout(timer);
      reject(err);

    });

    child.on("close", code => {

      if (finished) return;

      finished = true;
      clearTimeout(timer);

      const lines = stdout
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

      let parsed = null;

      for (let i = lines.length - 1; i >= 0; i--) {

        try {
          const value = JSON.parse(lines[i]);

          if (value && typeof value === "object") {
            parsed = value;
            break;
          }

        } catch (_) {}
      }

      if (!parsed) {

        const err = new Error(
          "Computer Agent returned no valid JSON result."
        );

        err.code = "COMPUTER_AGENT_INVALID_RESPONSE";
        err.stderr = stderr.slice(-2000);

        reject(err);
        return;
      }

      if (code !== 0 || parsed.success === false) {

        const err = new Error(
          parsed.error ||
          `Computer Agent failed with exit code ${code}.`
        );

        err.code = "COMPUTER_AGENT_EXECUTION_FAILED";
        err.result = parsed;

        reject(err);
        return;
      }

      resolve(parsed);
    });
  });
}

const ComputerAgent = {

  id: "computer",

  name: "Universal Computer Agent",

  description:
    "Controls Windows applications, keyboard, mouse and desktop workflows through the secured Arena Gateway.",

  capabilities: [
    "windows_apps",
    "keyboard",
    "mouse",
    "typing",
    "desktop_control",
    "application_launch",
    "application_close",
    "window_control"
  ],

  risk_level: "LEVEL_1",

  priority: 10,

  enabled: true,

  canHandle(command) {
    return typeof command === "string" &&
      looksLikeComputerCommand(command);
  },

  async execute({ command }) {
    return runGateway(command);
  },

  async createTask({ command, metadata = {} }) {

    return {
      command,
      metadata: {
        ...metadata,
        agent_id: "computer",
        agent_name: "Universal Computer Agent"
      }
    };
  }
};

module.exports = {
  ComputerAgent,
  runGateway,
  looksLikeComputerCommand
};

