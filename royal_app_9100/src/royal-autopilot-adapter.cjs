"use strict";

/*
 * ROYAL JARVIS — Controlled Arena Autopilot Adapter
 *
 * Pipeline:
 *
 * Arena
 *   -> this adapter
 *   -> RoyalArenaGateway.py
 *   -> IntentParser.py
 *   -> UniversalExecutor.py
 *   -> Windows
 *
 * This adapter deliberately uses:
 *   - absolute executable paths
 *   - spawn()
 *   - shell:false
 *   - argv arrays
 *   - JSON stdout contract
 *
 * It does NOT execute arbitrary shell commands.
 */

const path = require("path");
const { spawn } = require("child_process");
const { verifyCommand } = require("../../Core/VerificationEngine.cjs");

const PYTHON = "D:\\\\01_ROYAL_JARVIS\\\\.venv\\\\Scripts\\\\python.exe";

const GATEWAY = path.resolve(
  "D:\\01_ROYAL_JARVIS\\Autopilot\\RoyalArenaGateway.py"
);

const COMMAND_MAX_LENGTH = 2000;
const DEFAULT_TIMEOUT_MS = 120000;

function validateCommand(command) {
  if (typeof command !== "string") {
    throw new Error("command must be a string");
  }

  const value = command.trim();

  if (!value) {
    throw new Error("command must not be empty");
  }

  if (value.length > COMMAND_MAX_LENGTH) {
    throw new Error(`command exceeds ${COMMAND_MAX_LENGTH} characters`);
  }

  return value;
}

function parseGatewayOutput(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  /*
   * UniversalExecutor and imported modules may emit logging before
   * the gateway's final JSON response. Search from the end so the
   * final JSON object is authoritative.
   */
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const value = JSON.parse(lines[i]);

      if (value && typeof value === "object") {
        return value;
      }
    } catch {
      // Continue searching previous lines.
    }
  }

  return null;
}

function runGateway(command, controls, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(
      PYTHON,
      [GATEWAY, command],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}

      finish(
        reject,
        new Error(`RoyalArenaGateway timed out after ${timeoutMs} ms`)
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      finish(reject, err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);

      if (controls && controls.isCancelRequested()) {
        finish(reject, new Error("Arena cancellation requested"));
        return;
      }

      const payload = parseGatewayOutput(stdout);

      if (code !== 0) {
        const detail =
          payload?.message ||
          payload?.details ||
          stderr.trim() ||
          `Gateway exited with code ${code}`;

        finish(reject, new Error(detail));
        return;
      }

      if (!payload || payload.success !== true) {
        finish(
          reject,
          new Error(
            payload?.message ||
            payload?.error ||
            "Gateway returned an invalid success response"
          )
        );
        return;
      }

      finish(resolve, payload);
    });

    if (controls) {
      const interval = setInterval(() => {
        if (settled) {
          clearInterval(interval);
          return;
        }

        if (controls.isCancelRequested()) {
          clearInterval(interval);

          try {
            child.kill("SIGTERM");
          } catch {}

          finish(reject, new Error("Arena cancellation requested"));
        }
      }, 250);
    }
  });
}

class RoyalAutopilotExecutionAdapter {
  constructor(options = {}) {
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  }

  async planTask(task) {
    /*
     * IntentParser is the authoritative planner.
     *
     * Arena therefore creates one controlled dispatch step.
     * The Python gateway performs the actual LLM planning immediately
     * before execution.
     */
    return {
      steps: [
        {
          name: "royal_autopilot_dispatch",
          action: "royal.autopilot.dispatch",
          params: {
            command: task.command
          }
        }
      ]
    };
  }

  async executeTask(task, controls = {}) {
    const command = validateCommand(task.command);

    const step = Array.isArray(task.steps) ? task.steps[0] : null;

    if (!step) {
      throw new Error("Royal Autopilot task has no execution step.");
    }

    controls.onStepStarted?.(step);

    try {
      const result = await runGateway(
        command,
        controls,
        this.timeoutMs
      );

      controls.onStepCompleted?.(step, result);

      return {
        success: true,
        adapter: "royal-autopilot",
        gateway: "RoyalArenaGateway.py",
        command,
        result
      };
    } catch (error) {
      controls.onStepFailed?.(step, error);

      throw error;
    }
  }

  async verifyTask(task, { result } = {}) {
    if (!result || result.success !== true) {
      return {
        ok: false,
        details: "Royal Autopilot execution did not report success."
      };
    }

    if (!result.result || result.result.success !== true) {
      return {
        ok: false,
        details: "Gateway did not report successful execution."
      };
    }

    const independent = await verifyCommand(
      task.command,
      result.result
    );

    if (!independent.ok) {
      return {
        ok: false,
        details: {
          adapter: "royal-autopilot",
          gateway: "RoyalArenaGateway.py",
          task_id: task.task_id,
          independent_verification: independent
        }
      };
    }

    return {
      ok: true,
      details: {
        adapter: "royal-autopilot",
        gateway: "RoyalArenaGateway.py",
        task_id: task.task_id,
        independent_verification: independent
      }
    };
  }

  async cancelTask() {
    /*
     * Actual process cancellation is handled by runGateway().
     * This method is intentionally best-effort.
     */
    return {
      cancelled: true,
      adapter: "royal-autopilot"
    };
  }
}

function createRoyalAutopilotAdapter(options = {}) {
  return new RoyalAutopilotExecutionAdapter(options);
}

module.exports = {
  RoyalAutopilotExecutionAdapter,
  createRoyalAutopilotAdapter
};



