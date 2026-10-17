"use strict";

const EventEmitter = require("node:events");

const TERMINAL = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED"
]);

class EmergencyStopController extends EventEmitter {
  constructor({ orchestrator = null } = {}) {
    super();

    this.orchestrator = orchestrator;

    this.engaged = false;
    this.engagedAt = null;
    this.reason = null;
    this.engagedBy = null;
  }

  engage(
    reason = "Emergency stop engaged",
    engagedBy = "system"
  ) {
    if (this.engaged) {
      return this.status();
    }

    this.engaged = true;
    this.engagedAt = new Date().toISOString();
    this.reason = String(reason);
    this.engagedBy = String(engagedBy);

    /*
     * IMPORTANT:
     * Do NOT call orchestrator.shutdown().
     *
     * shutdown() permanently closes the Orchestrator until the
     * Node process is restarted. Emergency Stop must support:
     *
     * ENGAGE -> CANCEL -> RESET -> RE-ARM
     *
     * Therefore we use cooperative task cancellation only.
     */

    if (this.orchestrator) {
      const registry = this.orchestrator.registry;

      if (
        registry &&
        typeof registry.list === "function" &&
        typeof this.orchestrator.cancelTask === "function"
      ) {
        for (const task of registry.list()) {
          if (!task || TERMINAL.has(task.status)) {
            continue;
          }

          try {
            const result = this.orchestrator.cancelTask(
              task.task_id,
              "emergency_stop"
            );

            if (result && typeof result.catch === "function") {
              result.catch(() => {});
            }
          } catch (_) {}
        }
      }
    }

    this.emit("engaged", this.status());

    return this.status();
  }

  reset() {
    this.engaged = false;
    this.engagedAt = null;
    this.reason = null;
    this.engagedBy = null;

    this.emit("reset", this.status());

    return this.status();
  }

  isEngaged() {

    return this.engaged === true;

  }


  assertAllowed() {
    if (this.engaged) {
      const err = new Error(
        "ROYAL JARVIS emergency stop is engaged."
      );

      err.code = "EMERGENCY_STOP_ENGAGED";
      err.statusCode = 503;

      throw err;
    }

    return true;
  }

  status() {
    return {
      engaged: this.engaged,
      engaged_at: this.engagedAt,
      reason: this.reason,
      engaged_by: this.engagedBy
    };
  }
}

function createEmergencyStopController(options = {}) {
  return new EmergencyStopController(options);
}

module.exports = {
  EmergencyStopController,
  createEmergencyStopController
};

