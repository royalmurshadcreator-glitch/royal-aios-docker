'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — cancellation.cjs
 *
 * Cooperative cancellation.
 *
 *   - A cancellation request flips task.cancel_requested = true and is
 *     recorded here.
 *   - The orchestrator checks cancellation BEFORE every step; adapters
 *     receive an isCancelRequested() probe and must honor it between
 *     units of work.
 *   - This module NEVER force-kills external processes. Adapters may
 *     implement graceful stop signals; killing children is out of scope
 *     for BUILD #1 (see SECURITY.md).
 */

class CancelledError extends Error {
  constructor(message = 'Task was cancelled.') {
    super(message);
    this.name = 'CancelledError';
    this.code = 'task_cancelled';
    this.retryable = false;
  }
}

class CancellationController {
  constructor() {
    this._requested = new Set(); // task_ids with pending cancellation
  }

  /** Mark cancellation requested for a task. Idempotent. */
  request(taskId) {
    this._requested.add(taskId);
  }

  isRequested(taskId) {
    return this._requested.has(taskId);
  }

  /** Clear a request (on terminal transition or controlled retry). */
  clear(taskId) {
    return this._requested.delete(taskId);
  }

  /**
   * Handle passed to execution adapters.
   * @param {string} taskId
   * @param {() => boolean} [extraProbe] - e.g. task.cancel_requested flag
   */
  createHandle(taskId, extraProbe) {
    return {
      isCancelRequested: () => this._requested.has(taskId) || (extraProbe ? extraProbe() : false),
      throwIfCancelled: () => {
        if (this._requested.has(taskId) || (extraProbe ? extraProbe() : false)) {
          throw new CancelledError();
        }
      },
    };
  }

  get size() {
    return this._requested.size;
  }
}

module.exports = { CancellationController, CancelledError };
