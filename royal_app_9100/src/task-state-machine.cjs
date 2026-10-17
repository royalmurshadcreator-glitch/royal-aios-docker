'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — task-state-machine.cjs
 *
 * Explicit task lifecycle state machine.
 *
 *   CREATED ──▶ PLANNED ──▶ QUEUED ──▶ EXECUTING ──▶ VERIFYING ──▶ COMPLETED
 *      │          │          │  ▲          │             │
 *      │          │          ▼  │          ▼             ▼
 *      │          │     WAITING_│       RECOVERING ◀──────┘        FAILED ──▶ QUEUED (controlled retry)
 *      │          │     CONFIRMATION   (bounded)
 *      │          │          │
 *      ▼          ▼          ▼
 *                          CANCELLED
 *
 * Rules:
 *   - Only transitions listed below are legal.
 *   - Invalid transitions throw TransitionError; the task is never mutated.
 *   - Every legal transition is recorded on the task + returned to the caller.
 */

const { TASK_STATUS, pushTransition, nowIso } = require('./task-model.cjs');

class TransitionError extends Error {
  constructor(from, to) {
    super(`Invalid task state transition: ${from} -> ${to}`);
    this.name = 'TransitionError';
    this.code = 'invalid_transition';
    this.httpStatus = 409;
    this.from = from;
    this.to = to;
  }
}

/**
 * Allowed transitions. Terminal states (COMPLETED, CANCELLED) have none.
 * FAILED -> QUEUED exists ONLY for the controlled retry path (retryTask()).
 */
const TRANSITIONS = Object.freeze({
  [TASK_STATUS.CREATED]: Object.freeze([
    TASK_STATUS.PLANNED,
    TASK_STATUS.QUEUED,
    TASK_STATUS.WAITING_CONFIRMATION,
    TASK_STATUS.CANCELLED,
    TASK_STATUS.FAILED,
  ]),
  [TASK_STATUS.PLANNED]: Object.freeze([
    TASK_STATUS.QUEUED,
    TASK_STATUS.WAITING_CONFIRMATION,
    TASK_STATUS.CANCELLED,
    TASK_STATUS.FAILED,
  ]),
  [TASK_STATUS.QUEUED]: Object.freeze([
    TASK_STATUS.EXECUTING,
    TASK_STATUS.WAITING_CONFIRMATION, // defense-in-depth re-gate
    TASK_STATUS.CANCELLED,
    TASK_STATUS.FAILED,
  ]),
  [TASK_STATUS.WAITING_CONFIRMATION]: Object.freeze([
    TASK_STATUS.QUEUED,   // confirmed
    TASK_STATUS.CANCELLED, // rejected / cancelled while waiting
    TASK_STATUS.FAILED,
  ]),
  [TASK_STATUS.EXECUTING]: Object.freeze([
    TASK_STATUS.VERIFYING,
    TASK_STATUS.FAILED,
    TASK_STATUS.CANCELLED,
    TASK_STATUS.RECOVERING,
  ]),
  [TASK_STATUS.VERIFYING]: Object.freeze([
    TASK_STATUS.COMPLETED,
    TASK_STATUS.FAILED,
    TASK_STATUS.RECOVERING,
    TASK_STATUS.CANCELLED,
  ]),
  [TASK_STATUS.RECOVERING]: Object.freeze([
    TASK_STATUS.QUEUED,
    TASK_STATUS.EXECUTING,
    TASK_STATUS.FAILED,
    TASK_STATUS.CANCELLED,
  ]),
  [TASK_STATUS.FAILED]: Object.freeze([
    TASK_STATUS.QUEUED, // controlled manual retry only
  ]),
  [TASK_STATUS.COMPLETED]: Object.freeze([]),
  [TASK_STATUS.CANCELLED]: Object.freeze([]),
});

function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

/**
 * Apply a legal transition to a task object (mutates + records).
 *
 * Timestamp policy:
 *   - EXECUTING           -> started_at (first time only)
 *   - COMPLETED/FAILED/
 *     CANCELLED           -> completed_at (first time only)
 *   - any transition      -> updated_at
 *
 * @returns {{from:string, to:string, at:string}} transition record
 */
function applyTransition(task, to, reason) {
  const from = task.status;
  assertTransition(from, to);

  const at = nowIso();
  task.status = to;
  if (to === TASK_STATUS.EXECUTING && !task.started_at) task.started_at = at;
  if (
    (to === TASK_STATUS.COMPLETED || to === TASK_STATUS.FAILED || to === TASK_STATUS.CANCELLED) &&
    !task.completed_at
  ) {
    task.completed_at = at;
  }
  task.updated_at = at;
  pushTransition(task, from, to, reason || null);
  return { from, to, at };
}

/** List of legal target states for a given state (introspection / docs). */
function legalTargets(from) {
  return [...(TRANSITIONS[from] || [])];
}

module.exports = {
  TransitionError,
  TRANSITIONS,
  canTransition,
  assertTransition,
  applyTransition,
  legalTargets,
};
