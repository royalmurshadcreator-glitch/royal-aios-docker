'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — task-model.cjs
 *
 * Formal task object definition + factories + serializers.
 * Tasks are plain JSON-serializable objects (no classes) so they can be
 * persisted, cloned and shipped to the dashboard without ceremony.
 */

const crypto = require('node:crypto');
const { ValidationError } = require('./validation.cjs');

const TASK_STATUS = Object.freeze({
  CREATED: 'CREATED',
  PLANNED: 'PLANNED',
  QUEUED: 'QUEUED',
  WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  RECOVERING: 'RECOVERING',
});

const ALL_STATUSES = Object.freeze(Object.values(TASK_STATUS));

/** States after which a task record may be safely deleted from the registry. */
const DELETABLE_STATUSES = Object.freeze(
  new Set([TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED])
);

/** States in which the task is actively occupying an execution slot. */
const RUNNING_STATUSES = Object.freeze(
  new Set([TASK_STATUS.EXECUTING, TASK_STATUS.VERIFYING, TASK_STATUS.RECOVERING])
);

const STEP_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

const VERIFICATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

const RISK_LEVEL = Object.freeze({
  LEVEL_0: 'LEVEL_0', // read-only / informational
  LEVEL_1: 'LEVEL_1', // safe reversible actions
  LEVEL_2: 'LEVEL_2', // system/file/application modifications with safeguards
  LEVEL_3: 'LEVEL_3', // high-risk or irreversible
});

const MAX_TRANSITION_LOG = 20; // keep records compact

function nowIso() {
  return new Date().toISOString(); // stable, sortable ISO-8601 UTC
}

/**
 * Unique, compact, sortable-ish task id.
 * Format: task_<base36 epoch ms>_<12 hex chars from crypto CSPRNG>
 */
function generateTaskId() {
  const time = Date.now().toString(36);
  const rand = crypto.randomBytes(6).toString('hex'); // 12 hex chars
  return `task_${time}_${rand}`;
}

/**
 * Create a normalized plan step.
 * @param {{name:string, action?:string, params?:object}} input
 * @param {number} index
 */
function createStep(input, index) {
  const name = typeof input?.name === 'string' && input.name.trim()
    ? input.name.trim().slice(0, 120)
    : `step_${index + 1}`;
  return {
    index,
    name,
    action: typeof input?.action === 'string' ? input.action.slice(0, 120) : 'generic',
    params:
      input?.params && typeof input.params === 'object' && !Array.isArray(input.params)
        ? input.params
        : {},
    status: STEP_STATUS.PENDING,
    started_at: null,
    completed_at: null,
    error: null,
  };
}

/**
 * Create the formal task object.
 * All timestamps are stable ISO-8601 strings.
 */
function createTask(params) {
  if (!params || typeof params.command !== 'string' || !params.command.trim()) {
    throw new ValidationError('Task requires a non-empty command string.', 'command', 'invalid_command');
  }
  const at = nowIso();
  const steps = Array.isArray(params.steps)
    ? params.steps.slice(0, 50).map((s, i) => createStep(s, i))
    : [];

  return {
    task_id: params.task_id || generateTaskId(),
    parent_task_id: params.parent_task_id || null,
    command: params.command.trim(),
    source: params.source || 'dashboard',
    priority: Number.isFinite(params.priority) ? Math.trunc(params.priority) : 10,
    risk_level: params.risk_level || RISK_LEVEL.LEVEL_1,
    requires_confirmation: params.requires_confirmation === true,
    status: TASK_STATUS.CREATED,
    created_at: at,
    started_at: null,
    completed_at: null,
    updated_at: at,
    current_step: 0,
    total_steps: steps.length,
    steps,
    result: null,
    error: null,
    retry_count: 0,
    max_retries: Number.isFinite(params.max_retries) ? Math.max(0, Math.trunc(params.max_retries)) : 3,
    cancel_requested: false,
    verification_status: VERIFICATION_STATUS.PENDING,
    metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : {},
    transitions: [{ from: null, to: TASK_STATUS.CREATED, at, reason: 'created' }],
  };
}

/** Record a state transition inside the task (capped, compact). */
function pushTransition(task, from, to, reason) {
  if (!Array.isArray(task.transitions)) task.transitions = [];
  task.transitions.push({ from, to, at: nowIso(), reason: reason || null });
  if (task.transitions.length > MAX_TRANSITION_LOG) {
    task.transitions.splice(0, task.transitions.length - MAX_TRANSITION_LOG);
  }
}

function touchTask(task) {
  task.updated_at = nowIso();
}

function isTerminal(task) {
  return DELETABLE_STATUSES.has(task.status);
}

function isRunning(task) {
  return RUNNING_STATUSES.has(task.status);
}

/** Deep, JSON-safe clone of a task (for APIs and snapshots). */
function serializeTask(task) {
  return JSON.parse(JSON.stringify(task));
}

/** Shorter task shape for list endpoints (keeps payloads + records compact). */
function summarizeTask(task) {
  return {
    task_id: task.task_id,
    parent_task_id: task.parent_task_id || null,
    command: task.command.length > 140 ? `${task.command.slice(0, 137)}...` : task.command,
    source: task.source,
    priority: task.priority,
    risk_level: task.risk_level,
    requires_confirmation: task.requires_confirmation,
    status: task.status,
    created_at: task.created_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
    updated_at: task.updated_at,
    current_step: task.current_step,
    total_steps: task.total_steps,
    cancel_requested: task.cancel_requested,
    verification_status: task.verification_status,
    retry_count: task.retry_count,
    error: task.error ? { code: task.error.code, message: task.error.message } : null,
  };
}

/**
 * Compact record persisted to tasks.json (history).
 * Deliberately small: full fidelity lives in logs, durability lives here.
 */
function toHistoryRecord(task) {
  return {
    task_id: task.task_id,
    command: task.command.length > 300 ? `${task.command.slice(0, 297)}...` : task.command,
    source: task.source,
    status: task.status,
    risk_level: task.risk_level,
    created_at: task.created_at,
    started_at: task.started_at || null,
    completed_at: task.completed_at || null,
    result: summarizeResult(task.result),
    error: task.error ? { code: task.error.code, message: task.error.message } : null,
    retry_count: task.retry_count,
    verification_status: task.verification_status || VERIFICATION_STATUS.PENDING,
  };
}

/** Cap result payloads so history stays compact on disk. */
function summarizeResult(result) {
  if (result === null || result === undefined) return null;
  let s;
  try {
    s = JSON.stringify(result);
  } catch {
    return { truncated: true, preview: '[unserializable result]' };
  }
  if (s === undefined) return null;
  if (s.length <= 2048) return result;
  return { truncated: true, preview: s.slice(0, 500) };
}

module.exports = {
  TASK_STATUS,
  ALL_STATUSES,
  DELETABLE_STATUSES,
  RUNNING_STATUSES,
  STEP_STATUS,
  VERIFICATION_STATUS,
  RISK_LEVEL,
  nowIso,
  generateTaskId,
  createTask,
  createStep,
  pushTransition,
  touchTask,
  isTerminal,
  isRunning,
  serializeTask,
  summarizeTask,
  toHistoryRecord,
};
