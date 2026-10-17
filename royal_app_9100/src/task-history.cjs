'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — task-history.cjs
 *
 * Durable, compact task history persisted as JSON on disk.
 *
 * Storage design (deliberately separate from App/data/memory.json):
 *   - File:  <dataDir>/tasks.json      (default App/data/tasks.json)
 *   - Shape: { version, created_at, updated_at, tasks: [compactRecord...] }
 *   - Capped at maxRecords (default 500) — memory-safe, CPU-safe.
 *
 * Safety properties:
 *   - Atomic writes: write <file>.tmp then fs.renameSync (same volume).
 *   - Corruption-proof load: a broken file is quarantined next to the
 *     original (timestamped .bak) and history restarts empty — the
 *     orchestrator never crashes on a damaged tasks.json.
 *   - NEVER reads or writes memory.json (future integration is a
 *     separate adapter; see ARCHITECTURE.md).
 */

const fs = require('node:fs');
const path = require('node:path');
const { toHistoryRecord, nowIso } = require('./task-model.cjs');

const HISTORY_VERSION = 1;

class TaskHistory {
  /**
   * @param {object} options
   * @param {string} options.filePath - absolute path of tasks.json
   * @param {number} [options.maxRecords=500]
   * @param {boolean} [options.prettyPrint=false]
   * @param {{warn:Function}} [options.logger]
   */
  constructor(options = {}) {
    if (!options.filePath || typeof options.filePath !== 'string') {
      throw new Error('TaskHistory requires options.filePath');
    }
    this._file = options.filePath;
    this._tmp = `${options.filePath}.tmp`;
    this._maxRecords = Math.max(10, Number(options.maxRecords) || 500);
    this._pretty = options.prettyPrint === true;
    this._logger = options.logger || null;

    this._data = this._emptyStore();
    this._recoveredFromCorruption = false;
    this.load();
  }

  _emptyStore() {
    return { version: HISTORY_VERSION, created_at: nowIso(), updated_at: nowIso(), tasks: [] };
  }

  wasRecoveredFromCorruption() {
    return this._recoveredFromCorruption;
  }

  getRecordCount() {
    return this._data.tasks.length;
  }

  /** Load from disk; quarantine + recover on any corruption. */
  load() {
    let raw;
    try {
      raw = fs.readFileSync(this._file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        this._data = this._emptyStore();
        return; // fresh start — not corruption
      }
      return this._quarantineAndReset(`unreadable history file (${err.code || 'io_error'})`);
    }

    if (!raw || !raw.trim()) {
      this._data = this._emptyStore();
      return; // empty file treated as fresh
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this._quarantineAndReset('invalid JSON');
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
      return this._quarantineAndReset('unexpected structure');
    }

    // Keep only well-formed records with a string task_id.
    const tasks = parsed.tasks.filter(
      (t) => t && typeof t === 'object' && typeof t.task_id === 'string'
    );
    this._data = {
      version: HISTORY_VERSION,
      created_at: typeof parsed.created_at === 'string' ? parsed.created_at : nowIso(),
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : nowIso(),
      tasks: tasks.slice(-this._maxRecords),
    };
  }

  /** Upsert (by task_id) a task's compact record and persist atomically. */
  recordTask(task) {
    if (!task || typeof task.task_id !== 'string') return;
    const record = toHistoryRecord(task);
    const idx = this._data.tasks.findIndex((t) => t.task_id === task.task_id);
    if (idx >= 0) this._data.tasks[idx] = record;
    else this._data.tasks.push(record);
    if (this._data.tasks.length > this._maxRecords) {
      this._data.tasks.splice(0, this._data.tasks.length - this._maxRecords);
    }
    this._data.updated_at = nowIso();
    this.save();
  }

  getRecord(taskId) {
    return this._data.tasks.find((t) => t.task_id === taskId) || null;
  }

  /**
   * Newest first.
   * @param {{limit?: number, offset?: number, status?: string}} [filter]
   */
  listRecords(filter = {}) {
    const { limit = 100, offset = 0, status } = filter;
    let out = status ? this._data.tasks.filter((t) => t.status === status) : [...this._data.tasks];
    out.reverse(); // storage is append-order; newest last
    const capped = Math.max(1, Math.min(Number(limit) || 100, this._maxRecords));
    return { records: out.slice(Math.max(0, offset), Math.max(0, offset) + capped), total: out.length };
  }

  /**
   * Atomic write: tmp file + rename. Synchronous on purpose — single
   * writer, tiny files, and crash-safety over throughput.
   */
  save() {
    fs.mkdirSync(path.dirname(this._file), { recursive: true });
    const payload = JSON.stringify(this._data, null, this._pretty ? 2 : 0);
    fs.writeFileSync(this._tmp, payload, 'utf8');
    try {
      fs.renameSync(this._tmp, this._file);
    } catch (err) {
      // Windows can refuse rename-over-existing on exotic filesystems;
      // fall back to copy+unlink and keep going.
      try {
        fs.copyFileSync(this._tmp, this._file);
        fs.unlinkSync(this._tmp);
      } catch (err2) {
        this._warn(`history save failed: ${err2.message}`);
        throw err2;
      }
      this._warn(`history rename fallback used: ${err.message}`);
    }
  }

  stats() {
    return {
      file: this._file,
      records: this._data.tasks.length,
      maxRecords: this._maxRecords,
      recoveredFromCorruption: this._recoveredFromCorruption,
      updated_at: this._data.updated_at,
    };
  }

  // --- internals ---------------------------------------------------------------

  _quarantineAndReset(reason) {
    this._recoveredFromCorruption = true;
    try {
      // Windows filename-safe timestamp (no ':' characters).
      const stamp = nowIso().replace(/[:.]/g, '-');
      const bak = `${this._file}.corrupt-${stamp}.bak`;
      fs.renameSync(this._file, bak);
      this._warn(`tasks.json was ${reason}; quarantined to ${path.basename(bak)}, starting fresh.`);
    } catch (err) {
      this._warn(`could not quarantine corrupt tasks.json: ${err.message}`);
    }
    this._data = this._emptyStore();
  }

  _warn(msg) {
    if (this._logger && typeof this._logger.warn === 'function') this._logger.warn(msg);
  }
}

module.exports = { TaskHistory, HISTORY_VERSION };
