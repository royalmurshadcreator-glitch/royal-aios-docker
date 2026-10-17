'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — confirmation.cjs
 *
 * Risk-aware confirmation gate.
 *
 *   - LEVEL_0 / LEVEL_1 tasks flow straight through.
 *   - LEVEL_2 / LEVEL_3 tasks (or explicit requires_confirmation) are held
 *     in WAITING_CONFIRMATION until an explicit approve/reject arrives.
 *   - There is NO auto-approve path. Confirmation can never be bypassed
 *     silently: the orchestrator double-checks approval at execution time.
 */

const { RISK_LEVEL } = require('./task-model.cjs');

class ConfirmationError extends Error {
  constructor(message, code = 'confirmation_error', httpStatus = 409) {
    super(message);
    this.name = 'ConfirmationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

class ConfirmationManager {
  constructor() {
    /** task_id -> { status: 'pending'|'approved'|'rejected', requested_at, decided_at, note } */
    this._records = new Map();
  }

  /**
   * Does this task need a human decision before execution?
   * @param {string} riskLevel
   * @param {boolean} [explicitFlag]
   * @param {string[]} [requiredFor] - levels requiring confirmation
   */
  requiresConfirmation(riskLevel, explicitFlag = false, requiredFor = [RISK_LEVEL.LEVEL_2, RISK_LEVEL.LEVEL_3]) {
    if (explicitFlag === true) return true;
    return requiredFor.includes(riskLevel);
  }

  /** Register a pending confirmation request. Idempotent per task. */
  requestConfirmation(task, note) {
    if (!task || typeof task.task_id !== 'string') {
      throw new ConfirmationError('Cannot request confirmation for invalid task.', 'invalid_task', 400);
    }
    const existing = this._records.get(task.task_id);
    if (existing) return existing;
    const record = {
      status: 'pending',
      requested_at: task.updated_at || new Date().toISOString(),
      decided_at: null,
      note: note || null,
    };
    this._records.set(task.task_id, record);
    return record;
  }

  /** Explicit human approval. Throws if nothing is pending. */
  approve(taskId, note) {
    const record = this._records.get(taskId);
    if (!record || record.status !== 'pending') {
      throw new ConfirmationError(
        'No pending confirmation for this task.',
        'no_pending_confirmation',
        409
      );
    }
    record.status = 'approved';
    record.decided_at = new Date().toISOString();
    if (note) record.note = String(note).slice(0, 200);
    return record;
  }

  /** Explicit human rejection. Throws if nothing is pending. */
  reject(taskId, note) {
    const record = this._records.get(taskId);
    if (!record || record.status !== 'pending') {
      throw new ConfirmationError(
        'No pending confirmation for this task.',
        'no_pending_confirmation',
        409
      );
    }
    record.status = 'rejected';
    record.decided_at = new Date().toISOString();
    if (note) record.note = String(note).slice(0, 200);
    return record;
  }

  isApproved(taskId) {
    return this._records.get(taskId)?.status === 'approved';
  }

  isPending(taskId) {
    return this._records.get(taskId)?.status === 'pending';
  }

  getStatus(taskId) {
    return this._records.get(taskId)?.status || null;
  }

  /** Forget a record (terminal cleanup). */
  clear(taskId) {
    return this._records.delete(taskId);
  }

  /** Introspection for stats/dashboard. */
  listPending() {
    const out = [];
    for (const [task_id, rec] of this._records) {
      if (rec.status === 'pending') out.push({ task_id, requested_at: rec.requested_at });
    }
    return out;
  }
}

module.exports = { ConfirmationManager, ConfirmationError };
