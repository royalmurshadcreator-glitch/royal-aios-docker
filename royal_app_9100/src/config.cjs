'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR â€” config.cjs
 *
 * Central configuration factory. Hardware-aware defaults tuned for:
 *   - Intel i7-8650U (4c/8t mobile CPU)
 *   - 16 GB RAM
 *   - CPU-only local inference via Ollama
 *
 * Zero external dependencies. CommonJS.
 */

const path = require('node:path');

const MODULE_ROOT = path.join(__dirname, '..');

const DEFAULTS = Object.freeze({
  // --- Queue / concurrency -------------------------------------------------
  // CPU-only inference machine: NEVER parallel-execute reasoning workloads.
  maxConcurrency: 1,          // hard default = 1 (see SECURITY.md / ARCHITECTURE.md)
  maxConcurrencyCeiling: 4,   // absolute ceiling even if caller asks for more

  // --- Retry / recovery ----------------------------------------------------
  maxRetries: 3,              // per-task retry ceiling (never infinite)
  autoRetry: false,           // aggressive auto-recovery intentionally OFF (BUILD #1)
  retryDelayMs: 500,          // delay before an auto-retry re-queues

  // --- Tasks ---------------------------------------------------------------
  defaultPriority: 10,        // 0 = highest. FIFO inside equal priority.
  maxStepsPerTask: 25,        // keep task records compact
  registryMaxTasks: 1000,     // in-memory cap; oldest terminal tasks evicted
  maxCommandLength: 2000,
  maxPriority: 99,

  // --- Risk / confirmation ---------------------------------------------------
  // Fail-closed: unmatched commands are treated as LEVEL_2 (require confirmation).
  defaultRiskLevel: 'LEVEL_2',
  confirmationRequiredFor: ['LEVEL_2', 'LEVEL_3'],

  // --- Verification ----------------------------------------------------------
  verificationStrict: true,   // failed verification => task FAILED

  // --- Execution ---------------------------------------------------------------
  taskTimeoutMs: 120000,      // overall per-task ceiling (CPU-only is slow)

  // --- Persistence --------------------------------------------------------------
  historyFileName: 'tasks.json',
  historyMaxRecords: 500,     // compact, capped local history
  historyPrettyPrint: false,  // compact JSON on disk

  // --- Logging ---------------------------------------------------------------------
  logDirName: 'logs',
  logFileName: 'orchestrator.jsonl',
  logMaxBytes: 1024 * 1024,   // 1 MB per active log file
  logMaxFiles: 3,             // keep at most 3 rotated files (bounded logs)

  // --- API adapter -------------------------------------------------------------------
  apiBasePath: '/api',
  apiMaxBodyBytes: 64 * 1024, // 64 KB request body cap
  apiMaxListLimit: 200,

  // --- Execution adapter ---------------------------------------------------------------
  adapter: {
    kind: 'stub',                         // 'stub' | 'bridge' | 'autopilot'
    bridgeUrl: 'http://127.0.0.1:3031',   // Royal Jarvis Master Bridge
    bridgeExecutePath: '/api/execute',    // MUST match the real bridge route (see INTEGRATION.md)
    bridgeTimeoutMs: 30000,
    stubStepDelayMs: 5,
    autopilotPythonPath: 'D:\\\\01_ROYAL_JARVIS\\\\.venv\\\\Scripts\\\\python.exe',
    autopilotScriptPath: '',              // e.g. D:\\01_ROYAL_JARVIS\\Autopilot\\UniversalExecutor.py
    autopilotTimeoutMs: 120000,
  },
});

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Minimal recursive merge for plain-object config overrides. */
function mergeDeep(base, override) {
  if (!isPlainObject(override)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = mergeDeep(base[k], v);
    else out[k] = v;
  }
  return out;
}

/**
 * Create a resolved, frozen orchestrator configuration.
 *
 * @param {object} [overrides]
 * @param {string} [overrides.dataDir] - Directory for tasks.json + logs/.
 *        In production this should be: D:\01_ROYAL_JARVIS\App\data
 * @returns {Readonly<object>} resolved config
 */
function createConfig(overrides = {}) {
  const { dataDir, ...rest } = overrides;
  const merged = mergeDeep(DEFAULTS, rest);

  const resolvedDataDir = dataDir
    ? path.resolve(String(dataDir))
    : path.join(MODULE_ROOT, 'data'); // safe standalone default (staging/dev/tests)

  const cfg = {
    ...merged,
    moduleRoot: MODULE_ROOT,
    dataDir: resolvedDataDir,
    historyFile: path.join(resolvedDataDir, merged.historyFileName),
    logDir: path.join(resolvedDataDir, merged.logDirName),
    logFile: path.join(resolvedDataDir, merged.logDirName, merged.logFileName),
  };

  // Hardware safety: clamp concurrency even if a caller tries to raise it.
  cfg.maxConcurrency = Math.max(
    1,
    Math.min(Number(cfg.maxConcurrency) || 1, merged.maxConcurrencyCeiling)
  );

  return Object.freeze(cfg);
}

module.exports = { createConfig, DEFAULTS, MODULE_ROOT };
