'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — task-registry.cjs
 *
 * In-memory registry of active + recent tasks.
 *
 *   - Bounded (default 1000); oldest TERMINAL tasks are evicted first.
 *   - Running/active tasks are never evicted.
 *   - deleteTask() refuses to delete non-terminal tasks — cancel them first.
 */

const { DELETABLE_STATUSES, touchTask } = require('./task-model.cjs');

class RegistryError extends Error {
  constructor(message, code = 'registry_error', httpStatus = 409) {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

class TaskRegistry {
  /**
   * @param {object} [options]
   * @param {number} [options.maxTasks=1000]
   */
  constructor(options = {}) {
    this._maxTasks = Math.max(10, Number(options.maxTasks) || 1000);
    this._tasks = new Map(); // task_id -> task (insertion order = creation order)
  }

  get size() {
    return this._tasks.size;
  }

  has(taskId) {
    return this._tasks.has(taskId);
  }

  /**
   * Register a freshly created task.
   * @returns the stored task (same reference — callers may mutate + touchTask)
   */
  createTask(task) {
    if (!task || typeof task.task_id !== 'string') {
      throw new RegistryError('Cannot register a task without a task_id.', 'invalid_task', 400);
    }
    if (this._tasks.has(task.task_id)) {
      throw new RegistryError(`Duplicate task_id: ${task.task_id}`, 'duplicate_task_id', 409);
    }
    this._tasks.set(task.task_id, task);
    this._evictIfNeeded();
    return task;
  }

  getTask(taskId) {
    return this._tasks.get(taskId) || null;
  }

  /**
   * Update a task. Accepts either:
   *   - a patch object (shallow-merged; array/object fields replaced), or
   *   - a function (task) => void | partial
   * updated_at is always refreshed. Status changes must go through the
   * state machine — this method intentionally does NOT validate transitions.
   */
  updateTask(taskId, patchOrFn) {
    const task = this._tasks.get(taskId);
    if (!task) {
      throw new RegistryError(`Task not found: ${taskId}`, 'task_not_found', 404);
    }
    if (typeof patchOrFn === 'function') {
      patchOrFn(task);
    } else if (patchOrFn && typeof patchOrFn === 'object') {
      Object.assign(task, patchOrFn);
    } else {
      throw new RegistryError('updateTask requires a patch object or function.', 'invalid_patch', 400);
    }
    touchTask(task);
    return task;
  }

  /**
   * Delete a task record. Hard rule: running / queued / waiting tasks must
   * be cancelled first — accidental deletion of live work is refused.
   */
  deleteTask(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) return false;
    if (!DELETABLE_STATUSES.has(task.status)) {
      throw new RegistryError(
        `Refusing to delete task in status ${task.status}. Cancel it first.`,
        'task_not_deletable',
        409
      );
    }
    return this._tasks.delete(taskId);
  }

  /**
   * List tasks, newest first.
   * @param {{status?: string|string[], source?: string, limit?: number, offset?: number}} [filter]
   */
  listTasks(filter = {}) {
    const { status, source, limit = 100, offset = 0 } = filter;
    const statusSet = status
      ? new Set(Array.isArray(status) ? status : [status])
      : null;
    let out = [];
    for (const task of this._tasks.values()) {
      if (statusSet && !statusSet.has(task.status)) continue;
      if (source && task.source !== source) continue;
      out.push(task);
    }
    out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const total = out.length;
    const capped = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const off = Math.max(0, Number(offset) || 0);
    return { tasks: out.slice(off, off + capped), total };
  }

  /** Count tasks grouped by status (for stats endpoint). */
  countByStatus() {
    const counts = {};
    for (const task of this._tasks.values()) {
      counts[task.status] = (counts[task.status] || 0) + 1;
    }
    return counts;
  }

  /** Evict oldest terminal tasks when over capacity. Never evicts live tasks. */
  _evictIfNeeded() {
    if (this._tasks.size <= this._maxTasks) return;
    let overflow = this._tasks.size - this._maxTasks;
    for (const [id, task] of this._tasks) {
      if (overflow <= 0) break;
      if (DELETABLE_STATUSES.has(task.status)) {
        this._tasks.delete(id);
        overflow--;
      }
    }
  }
}

module.exports = { TaskRegistry, RegistryError };
