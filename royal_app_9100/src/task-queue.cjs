'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — task-queue.cjs
 *
 * In-memory bounded task queue.
 *
 *   - FIFO by default (equal priority => arrival order)
 *   - Priority support: lower numeric priority runs first
 *   - Hard concurrency gate: getNextTask() returns null while at capacity
 *   - O(log n) binary min-heap; O(1) amortized lazy removal
 *
 * Memory profile: a handful of small objects per queued task — safe for
 * the 16 GB / i7-8650U target even with thousands of queued tasks.
 */

class QueueError extends Error {
  constructor(message, code = 'queue_error') {
    super(message);
    this.name = 'QueueError';
    this.code = code;
    this.httpStatus = 409;
  }
}

class TaskQueue {
  /**
   * @param {object} [options]
   * @param {number} [options.maxConcurrency=1] - max simultaneously ACTIVE tasks
   */
  constructor(options = {}) {
    this._maxConcurrency = Math.max(1, Math.min(Number(options.maxConcurrency) || 1, 4));
    this._heap = [];            // entries: { task, priority, seq, key }
    this._seq = 0;
    this._active = new Map();   // task_id -> task (currently executing)
    this._tombstones = new Set(); // lazily removed heap keys
    this._tombstoneCount = 0;
  }

  get maxConcurrency() {
    return this._maxConcurrency;
  }

  setMaxConcurrency(n) {
    this._maxConcurrency = Math.max(1, Math.min(Number(n) || 1, 4));
  }

  /** Number of tasks waiting in the queue (excluding tombstones). */
  get size() {
    return this._heap.length - this._tombstoneCount;
  }

  get sizeWaiting() {
    return this.size;
  }

  getActiveCount() {
    return this._active.size;
  }

  isActive(taskId) {
    return this._active.has(taskId);
  }

  isEmpty() {
    return this.size === 0;
  }

  /**
   * Add a task. FIFO within equal priority; lower priority value = sooner.
   * @returns {number} sequence number assigned
   */
  enqueueTask(task, priorityOverride) {
    if (!task || typeof task.task_id !== 'string') {
      throw new QueueError('Cannot enqueue a task without a task_id.', 'invalid_task');
    }
    const priority = Number.isFinite(priorityOverride)
      ? Math.trunc(priorityOverride)
      : Number.isFinite(task.priority)
        ? Math.trunc(task.priority)
        : 10;
    const seq = this._seq++;
    const key = `${task.task_id}#${seq}`;
    this._heap.push({ task, priority, seq, key });
    this._bubbleUp(this._heap.length - 1);
    return seq;
  }

  /** Peek at the next task that would run (does not remove it). */
  peek() {
    this._purgeTop();
    return this._heap.length ? this._heap[0].task : null;
  }

  /**
   * Dequeue the next task AND mark it active — but only when a
   * concurrency slot is free. Returns null when at capacity or empty.
   * The caller MUST eventually call releaseTask(task_id) or removeTask().
   */
  getNextTask() {
    if (this._active.size >= this._maxConcurrency) return null;
    this._purgeTop();
    if (this._heap.length === 0) return null;
    const entry = this._heap[0];
    this._heap[0] = this._heap[this._heap.length - 1];
    this._heap.pop();
    if (this._heap.length > 0) this._bubbleDown(0);
    this._active.set(entry.task.task_id, entry.task);
    return entry.task;
  }

  /**
   * Remove a waiting OR active task by id.
   * @returns {boolean} true if something was removed
   */
  removeTask(taskId) {
    let removed = false;
    if (this._active.delete(taskId)) removed = true;
    for (const entry of this._heap) {
      if (entry.task.task_id === taskId && !this._tombstones.has(entry.key)) {
        this._tombstones.add(entry.key);
        this._tombstoneCount++;
        removed = true;
      }
    }
    if (this._tombstoneCount > 64) this._compact();
    return removed;
  }

  /** Free a concurrency slot after execution finished/failed/cancelled. */
  releaseTask(taskId) {
    return this._active.delete(taskId);
  }

  /**
   * Ordered snapshot of WAITING tasks (does not include active ones).
   * Compact shapes only — safe to ship to the dashboard.
   */
  getQueue() {
    return this._heap
      .filter((e) => !this._tombstones.has(e.key))
      .sort((a, b) => (a.priority - b.priority) || (a.seq - b.seq))
      .map((e) => ({
        task_id: e.task.task_id,
        priority: e.priority,
        seq: e.seq,
        command: typeof e.task.command === 'string'
          ? e.task.command.slice(0, 120)
          : '',
      }));
  }

  /**
   * Safely clear all WAITING tasks. ACTIVE (executing) tasks are never
   * touched here — they belong to the orchestrator's cancellation path.
   * @returns {string[]} task_ids removed from the waiting queue
   */
  clearQueueSafely() {
    const removed = [];
    for (const entry of this._heap) {
      if (!this._tombstones.has(entry.key)) removed.push(entry.task.task_id);
    }
    this._heap = [];
    this._tombstones.clear();
    this._tombstoneCount = 0;
    return removed;
  }

  // --- internal heap machinery -------------------------------------------------

  /** Strict ordering: lower priority value first, then FIFO by sequence. */
  _less(a, b) {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.seq < b.seq;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._less(this._heap[i], this._heap[parent])) {
        [this._heap[i], this._heap[parent]] = [this._heap[parent], this._heap[i]];
        i = parent;
      } else break;
    }
  }

  _bubbleDown(i) {
    const n = this._heap.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < n && this._less(this._heap[l], this._heap[smallest])) smallest = l;
      if (r < n && this._less(this._heap[r], this._heap[smallest])) smallest = r;
      if (smallest === i) break;
      [this._heap[i], this._heap[smallest]] = [this._heap[smallest], this._heap[i]];
      i = smallest;
    }
  }

  _purgeTop() {
    while (this._heap.length > 0 && this._tombstones.has(this._heap[0].key)) {
      this._tombstones.delete(this._heap[0].key);
      this._tombstoneCount--;
      this._heap[0] = this._heap[this._heap.length - 1];
      this._heap.pop();
      if (this._heap.length > 0) this._bubbleDown(0);
    }
  }

  _compact() {
    this._heap = this._heap.filter((e) => !this._tombstones.has(e.key));
    this._tombstones.clear();
    this._tombstoneCount = 0;
    for (let i = (this._heap.length >> 1) - 1; i >= 0; i--) this._bubbleDown(i);
  }
}

module.exports = { TaskQueue, QueueError };
