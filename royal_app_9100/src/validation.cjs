'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — validation.cjs
 *
 * Input validation + sanitization utilities.
 * Security contract (see SECURITY.md):
 *   - Every external input is validated before touching the core.
 *   - Task IDs are strictly patterned (no path traversal, no injection).
 *   - Commands are treated as DATA, never as executable code.
 *   - No eval(), no Function(), no shell string construction anywhere.
 */

class ValidationError extends Error {
  constructor(message, field, code = 'validation_error') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.field = field || null;
    this.httpStatus = 400;
  }
}

/** task_<base36-ms>_<12 hex chars>  e.g. task_m5k2x9ab_3f9a1c77d2e0 */
const TASK_ID_RE = /^task_[a-z0-9]{6,14}_[a-f0-9]{12}$/;
const SOURCE_RE = /^[a-z0-9_.:\-]{1,64}$/i;
const RISK_LEVELS = Object.freeze(['LEVEL_0', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3']);

/**
 * Forbidden command characters: C0 control chars EXCEPT tab (\t=\x09),
 * LF (\n=\x0A) and CR (\r=\x0D), plus DEL. Kept as explicit escaped code
 * points so the source file itself never contains raw control bytes.
 * Ranges: \x00-\x08, \x0B, \x0C, \x0E-\x1F, \x7F
 */
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;


function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isValidTaskId(v) {
  return typeof v === 'string' && TASK_ID_RE.test(v);
}

function assertTaskId(v, field = 'task_id') {
  if (!isValidTaskId(v)) {
    throw new ValidationError('Invalid task_id format.', field, 'invalid_task_id');
  }
  return v;
}

/**
 * Validate + normalize a user command. Commands are plain text instructions
 * destined for IntentParser / UniversalExecutor — they are NEVER executed
 * by this module. We only enforce shape + safety basics.
 */
function assertCommand(v, maxLength = 2000) {
  if (typeof v !== 'string') {
    throw new ValidationError('Command must be a string.', 'command', 'invalid_command');
  }
  const trimmed = v.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Command must not be empty.', 'command', 'invalid_command');
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(
      `Command exceeds maximum length of ${maxLength} characters.`,
      'command',
      'invalid_command'
    );
  }
  if (CONTROL_CHARS_RE.test(trimmed)) {
    throw new ValidationError(
      'Command contains forbidden control characters.',
      'command',
      'invalid_command'
    );
  }
  return trimmed;
}

function assertSource(v) {
  if (v === undefined || v === null || v === '') return 'dashboard';
  const s = String(v).trim().toLowerCase();
  if (!SOURCE_RE.test(s)) {
    throw new ValidationError('Invalid source identifier.', 'source', 'invalid_source');
  }
  return s;
}

function assertPriority(v, { defaultPriority = 10, maxPriority = 99 } = {}) {
  if (v === undefined || v === null) return defaultPriority;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new ValidationError('Priority must be a number.', 'priority', 'invalid_priority');
  }
  return Math.max(0, Math.min(Math.trunc(n), maxPriority));
}

function normalizeRiskLevel(v) {
  if (typeof v !== 'string') return null;
  const up = v.trim().toUpperCase();
  return RISK_LEVELS.includes(up) ? up : null;
}

function assertRiskLevel(v) {
  const level = normalizeRiskLevel(v);
  if (!level) {
    throw new ValidationError(
      `Risk level must be one of: ${RISK_LEVELS.join(', ')}.`,
      'risk_level',
      'invalid_risk_level'
    );
  }
  return level;
}

/** Numeric rank lets us compare levels ("never downgrade"). */
function riskRank(level) {
  return RISK_LEVELS.indexOf(level);
}

/** Return the HIGHER (safer) of two risk levels. */
function maxRiskLevel(a, b) {
  return riskRank(a) >= riskRank(b) ? a : b;
}

/**
 * Detect path traversal / suspicious absolute-path fragments inside a string.
 * Used for metadata fields that look path-ish. We never build shell commands,
 * this is defense-in-depth for downstream consumers.
 */
function containsPathTraversal(v) {
  if (typeof v !== 'string') return false;
  if (v.includes('..')) return true;
  if (/%2e%2e|\.\.\\|\.\.\//i.test(v)) return true;
  return false;
}

/**
 * Sanitize free-form metadata:
 *   - must be a plain JSON-serializable object
 *   - capped serialized size + depth
 *   - path-ish string fields are screened for traversal
 */
function sanitizeMetadata(v, { maxBytes = 4096, maxDepth = 4 } = {}) {
  if (v === undefined || v === null) return {};
  if (!isPlainObject(v)) {
    throw new ValidationError('Metadata must be a plain object.', 'metadata', 'invalid_metadata');
  }
  const seen = new WeakSet();
  const sanitizeValue = (value, depth, key) => {
    if (depth > maxDepth) {
      throw new ValidationError('Metadata exceeds maximum nesting depth.', 'metadata', 'invalid_metadata');
    }
    if (value === null) return null;
    const t = typeof value;
    if (t === 'string') {
      if (value.length > 512) {
        throw new ValidationError('Metadata string value too long.', 'metadata', 'invalid_metadata');
      }
      if (/path|file|dir|folder/i.test(String(key)) && containsPathTraversal(value)) {
        throw new ValidationError(
          'Metadata path-like value contains path traversal.',
          'metadata',
          'path_traversal_detected'
        );
      }
      return value;
    }
    if (t === 'number' || t === 'boolean') return value;
    if (Array.isArray(value)) {
      if (seen.has(value)) throw new ValidationError('Circular metadata.', 'metadata', 'invalid_metadata');
      seen.add(value);
      if (value.length > 50) throw new ValidationError('Metadata array too large.', 'metadata', 'invalid_metadata');
      return value.map((item) => sanitizeValue(item, depth + 1, key));
    }
    if (t === 'object') {
      if (seen.has(value)) throw new ValidationError('Circular metadata.', 'metadata', 'invalid_metadata');
      seen.add(value);
      const out = {};
      for (const [k2, v2] of Object.entries(value)) {
        if (typeof k2 !== 'string' || k2.length > 64) {
          throw new ValidationError('Metadata key too long.', 'metadata', 'invalid_metadata');
        }
        out[k2] = sanitizeValue(v2, depth + 1, k2);
      }
      return out;
    }
    throw new ValidationError('Metadata contains unsupported value type.', 'metadata', 'invalid_metadata');
  };

  const clean = sanitizeValue(v, 0, '');
  let serialized;
  try {
    serialized = JSON.stringify(clean);
  } catch {
    throw new ValidationError('Metadata is not JSON-serializable.', 'metadata', 'invalid_metadata');
  }
  if (serialized.length > maxBytes) {
    throw new ValidationError('Metadata exceeds maximum size.', 'metadata', 'invalid_metadata');
  }
  return clean;
}

/**
 * Produce a client-safe error payload. NEVER includes stack traces,
 * file paths of the host, or internal details.
 */
function safeErrorFields(err, fallbackCode = 'internal_error') {
  const code = typeof err?.code === 'string' && /^[a-z0-9_]{2,64}$/.test(err.code)
    ? err.code
    : fallbackCode;
  let message = typeof err?.message === 'string' ? err.message : 'An internal error occurred.';
  if (message.length > 300) message = `${message.slice(0, 297)}...`;
  // Strip anything that looks like an absolute host path or a stack frame.
  message = message
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<path>')
    .replace(/\((?:[A-Za-z]:)?[^()]*\.(?:c?js|py):\d+:\d+\)/g, '')
    .replace(/\s+at\s+\S+/g, '');
  return { code, message };
}

module.exports = {
  ValidationError,
  RISK_LEVELS,
  isPlainObject,
  isValidTaskId,
  assertTaskId,
  assertCommand,
  assertSource,
  assertPriority,
  assertRiskLevel,
  normalizeRiskLevel,
  riskRank,
  maxRiskLevel,
  containsPathTraversal,
  sanitizeMetadata,
  safeErrorFields,
};
