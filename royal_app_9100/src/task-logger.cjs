'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — task-logger.cjs
 *
 * Structured JSON Lines logger (one JSON object per line).
 *
 *   - Bounded: rotates at maxBytes into <name>.N.jsonl (maxFiles kept).
 *   - Never logs secrets: keys matching credential patterns are redacted.
 *   - Never throws into caller code: logging failure degrades silently.
 *
 * Future rotation hook: swap _rotate() internals for a time-based policy
 * without changing the public API.
 */

const fs = require('node:fs');
const path = require('node:path');
const { nowIso } = require('./task-model.cjs');

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const SECRET_KEY_RE = /(secret|password|passwd|pwd|token|api[_-]?key|authorization|auth|cookie|credential)/i;
const MAX_FIELD_DEPTH = 4;

class TaskLogger {
  /**
   * @param {object} options
   * @param {string} options.logDir
   * @param {string} [options.fileName='orchestrator.jsonl']
   * @param {number} [options.maxBytes=1048576]
   * @param {number} [options.maxFiles=3]
   * @param {string} [options.minLevel='info']
   */
  constructor(options = {}) {
    if (!options.logDir || typeof options.logDir !== 'string') {
      throw new Error('TaskLogger requires options.logDir');
    }
    this._dir = options.logDir;
    this._fileName = options.fileName || 'orchestrator.jsonl';
    this._file = path.join(this._dir, this._fileName);
    this._maxBytes = Math.max(4096, Number(options.maxBytes) || 1024 * 1024);
    this._maxFiles = Math.max(1, Number(options.maxFiles) || 3);
    this._minLevel = LEVELS[options.minLevel] !== undefined ? options.minLevel : 'info';
    this._disabled = false;
    try {
      fs.mkdirSync(this._dir, { recursive: true });
    } catch {
      this._disabled = true; // no writable dir => logging disabled, core keeps working
    }
  }

  getLogPath() {
    return this._file;
  }

  debug(event, fields) { this.log('debug', event, fields); }
  info(event, fields) { this.log('info', event, fields); }
  warn(event, fields) { this.log('warn', event, fields); }
  error(event, fields) { this.log('error', event, fields); }

  /**
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} event - dotted event name, e.g. 'task.transition'
   * @param {object} [fields]
   */
  log(level, event, fields = {}) {
    if (this._disabled) return;
    if (LEVELS[level] === undefined) level = 'info';
    if (LEVELS[level] < LEVELS[this._minLevel]) return;
    const line = {
      ts: nowIso(),
      level,
      event: typeof event === 'string' ? event.slice(0, 120) : 'unknown',
      ...this._sanitizeFields(fields),
    };
    let serialized;
    try {
      serialized = JSON.stringify(line);
    } catch {
      serialized = JSON.stringify({ ts: line.ts, level: line.level, event: line.event, note: 'unserializable_fields' });
    }
    try {
      this._rotateIfNeeded(serialized.length + 1);
      fs.appendFileSync(this._file, `${serialized}\n`, 'utf8');
    } catch {
      /* logging must never take the orchestrator down */
    }
  }

  // --- internals ---------------------------------------------------------------

  _sanitizeFields(fields, depth = 0) {
    if (!fields || typeof fields !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(fields)) {
      if (SECRET_KEY_RE.test(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = this._sanitizeValue(value, depth + 1);
    }
    return out;
  }

  _sanitizeValue(value, depth) {
    if (value === null) return null;
    const t = typeof value;
    if (t === 'string') return value.length > 500 ? `${value.slice(0, 497)}...` : value;
    if (t === 'number' || t === 'boolean') return value;
    if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') return String(value);
    if (value instanceof Error) {
      return { name: value.name, message: String(value.message).slice(0, 300), code: value.code };
    }
    if (depth > MAX_FIELD_DEPTH) return '[truncated]';
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((v) => this._sanitizeValue(v, depth + 1));
    }
    if (t === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = SECRET_KEY_RE.test(k) ? '[REDACTED]' : this._sanitizeValue(v, depth + 1);
      }
      return out;
    }
    return String(value);
  }

  _rotateIfNeeded(incomingBytes) {
    let size = 0;
    try {
      size = fs.statSync(this._file).size;
    } catch {
      return; // no current file
    }
    if (size + incomingBytes <= this._maxBytes) return;
    // Shift older generations: .maxFiles-1 -> .maxFiles, ... .1 -> .2, current -> .1
    const stem = this._file;
    for (let i = this._maxFiles - 1; i >= 1; i--) {
      const from = `${stem}.${i}`;
      const to = `${stem}.${i + 1}`;
      try {
        if (fs.existsSync(from)) {
          if (i + 1 > this._maxFiles) fs.unlinkSync(from);
          else fs.renameSync(from, to);
        }
      } catch { /* keep going */ }
    }
    try {
      fs.renameSync(stem, `${stem}.1`);
    } catch { /* keep going */ }
  }
}

module.exports = { TaskLogger };
