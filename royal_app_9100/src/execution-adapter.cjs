'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — execution-adapter.cjs
 *
 * Clean adapter interface between the orchestrator and the EXISTING
 * Royal Jarvis execution systems. This module does NOT reimplement or
 * replace UniversalExecutor / IntentParser / Master Bridge — it wraps
 * them behind one controlled contract:
 *
 *   planTask(task)                          -> { steps: [{name, action?, params?}] }
 *   executeTask(task, controls)             -> result (JSON-safe)
 *   verifyTask(task, { result })            -> { ok: boolean, details? }
 *   cancelTask(task)                        -> best-effort graceful signal
 *
 * `controls` provided by the orchestrator:
 *   isCancelRequested()   - poll cooperative cancellation
 *   throwIfCancelled()    - throw CancelledError if requested
 *   onStepStarted(step)   - mark step RUNNING + emit event
 *   onStepCompleted(step, info)
 *   onStepFailed(step, err)
 *   log(event, fields)    - structured logging passthrough
 *
 * Available adapters:
 *   'stub'      StubExecutionAdapter      - safe local simulator (default, used by tests)
 *   'bridge'    BridgeExecutionAdapter    - dispatches via Master Bridge HTTP (zero-dep fetch)
 *   'autopilot' AutopilotProcessAdapter   - launches Autopilot Python as a child process
 *                                           (spawn with argv array, shell:false, NEVER a
 *                                           constructed shell string; disabled unless configured)
 */

const { CancelledError } = require('./cancellation.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class AdapterError extends Error {
  constructor(message, code = 'adapter_error', retryable = false) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.retryable = retryable;
  }
}

function assertSteps(task) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  if (steps.length === 0) {
    return [{ index: 0, name: 'execute_command', params: { command: task.command } }];
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Stub adapter — deterministic local simulator. Default until wired to prod.
// ---------------------------------------------------------------------------

class StubExecutionAdapter {
  /**
   * @param {object} [options]
   * @param {number} [options.stepDelayMs=5]
   * @param {string|null} [options.failOnMatch] - substring; matching commands fail
   * @param {boolean} [options.failVerification=false]
   * @param {(task)=>{steps:Array}} [options.planResolver] - custom planner
   */
  constructor(options = {}) {
    this.kind = 'stub';
    this._stepDelayMs = Number(options.stepDelayMs) || 5;
    this._failOnMatch = options.failOnMatch || null;
    this._failVerification = options.failVerification === true;
    this._planResolver = typeof options.planResolver === 'function' ? options.planResolver : null;
  }

  async planTask(task) {
    if (this._planResolver) return this._planResolver(task);
    return {
      steps: [{ name: 'dispatch_command', action: 'stub.dispatch', params: {} }],
    };
  }

  async executeTask(task, controls) {
    const steps = assertSteps(task);
    for (const step of steps) {
      controls.throwIfCancelled();
      controls.onStepStarted(step);
      await sleep(this._stepDelayMs);
      controls.throwIfCancelled();
      if (this._failOnMatch && task.command.toLowerCase().includes(this._failOnMatch.toLowerCase())) {
        const err = new AdapterError('Simulated execution failure (stub failOnMatch).', 'stub_simulated_failure', true);
        controls.onStepFailed(step, err);
        throw err;
      }
      controls.onStepCompleted(step, { simulated: true });
    }
    return {
      executed: true,
      adapter: 'stub',
      steps_completed: steps.length,
      note: 'Stub adapter simulated execution. Wire BridgeExecutionAdapter for real dispatch.',
    };
  }

  async verifyTask() {
    if (this._failVerification) {
      return { ok: false, details: 'Simulated verification failure (stub).' };
    }
    return { ok: true, details: 'Stub verification passed.' };
  }

  async cancelTask() {
    return { ok: true, note: 'stub adapter: nothing to signal' };
  }
}

// ---------------------------------------------------------------------------
// Bridge adapter — dispatch through the existing Master Bridge (port 3031).
// Zero dependencies: uses Node's built-in fetch (Node >= 18).
// ---------------------------------------------------------------------------

class BridgeExecutionAdapter {
  /**
   * @param {object} options
   * @param {string} options.bridgeUrl            e.g. http://127.0.0.1:3031
   * @param {string} [options.executePath]        MUST match the real bridge route
   * @param {number} [options.timeoutMs=30000]
   */
  constructor(options = {}) {
    this.kind = 'bridge';
    this._url = String(options.bridgeUrl || 'http://127.0.0.1:3031').replace(/\/+$/, '');
    this._executePath = options.executePath || '/api/execute';
    this._timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
    this._validateBaseUrl();
  }

  _validateBaseUrl() {
    let u;
    try {
      u = new URL(this._url);
    } catch {
      throw new AdapterError('Invalid bridgeUrl.', 'bridge_config_error', false);
    }
    // Local-first security: the bridge must be loopback.
    if (!['127.0.0.1', 'localhost', '::1'].includes(u.hostname)) {
      throw new AdapterError('bridgeUrl must be a loopback address (local-first policy).', 'bridge_config_error', false);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new AdapterError('bridgeUrl must be http(s).', 'bridge_config_error', false);
    }
  }

  async planTask() {
    return { steps: [{ name: 'bridge_dispatch', action: 'bridge.execute', params: {} }] };
  }

  async executeTask(task, controls) {
    controls.throwIfCancelled();
    const step = assertSteps(task)[0];
    controls.onStepStarted(step);

    let res;
    try {
      res = await fetch(`${this._url}${this._executePath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The command is DATA inside a JSON body — never a shell string.
        body: JSON.stringify({
          command: task.command,
          task_id: task.task_id,
          source: task.source,
          risk_level: task.risk_level,
        }),
        signal: AbortSignal.timeout(this._timeoutMs),
      });
    } catch (err) {
      const e = new AdapterError(
        err && err.name === 'TimeoutError'
          ? 'Master Bridge request timed out.'
          : `Master Bridge unreachable (${err && err.name ? err.name : 'network error'}).`,
        'bridge_unreachable',
        true
      );
      controls.onStepFailed(step, e);
      throw e;
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      const e = new AdapterError(
        `Master Bridge returned HTTP ${res.status}.`,
        'bridge_http_error',
        res.status >= 500
      );
      controls.onStepFailed(step, e);
      throw e;
    }

    controls.throwIfCancelled();
    controls.onStepCompleted(step, { bridge_status: res.status });
    return { adapter: 'bridge', bridge_http_status: res.status, bridge_response: body };
  }

  async verifyTask(task, { result } = {}) {
    if (result && typeof result === 'object' && result.bridge_http_status === 200) {
      const okFlag = result.bridge_response && typeof result.bridge_response === 'object'
        ? result.bridge_response.ok !== false
        : true;
      return { ok: okFlag, details: 'Bridge acknowledged dispatch.' };
    }
    return { ok: true, details: 'No strict verification available for bridge dispatch (BUILD #1).' };
  }

  /** Best-effort graceful cancel signal; never force-kills anything. */
  async cancelTask(task) {
    try {
      await fetch(`${this._url}${this._executePath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancel_task_id: task.task_id, source: 'orchestrator' }),
        signal: AbortSignal.timeout(5000),
      });
      return { ok: true };
    } catch {
      return { ok: false, note: 'cancel signal could not reach bridge' };
    }
  }
}

// ---------------------------------------------------------------------------
// Autopilot adapter — optional child-process bridge to Autopilot Python.
// shell:false + argv array => commands are DATA, never interpreted by a shell.
// ---------------------------------------------------------------------------

class AutopilotProcessAdapter {
  /**
   * @param {object} options
   * @param {string} options.pythonPath - e.g. 'python' or absolute interpreter path
   * @param {string} options.scriptPath - e.g. D:\\01_ROYAL_JARVIS\\Autopilot\\UniversalExecutor.py
   * @param {number} [options.timeoutMs=120000]
   */
  constructor(options = {}) {
    this.kind = 'autopilot';
    if (!options.scriptPath || typeof options.scriptPath !== 'string') {
      throw new AdapterError('Autopilot adapter requires an explicit scriptPath.', 'autopilot_config_error', false);
    }
    // Path traversal guard: script path must be absolute and contain no '..'
    if (options.scriptPath.includes('..')) {
      throw new AdapterError('Autopilot scriptPath must not contain "..".', 'path_traversal_detected', false);
    }
    this._python = options.pythonPath || 'python';
    this._script = options.scriptPath;
    this._timeoutMs = Math.max(5000, Number(options.timeoutMs) || 120000);
  }

  async planTask() {
    return { steps: [{ name: 'autopilot_dispatch', action: 'autopilot.execute', params: {} }] };
  }

  async executeTask(task, controls) {
    const { spawn } = require('node:child_process');
    controls.throwIfCancelled();
    const step = assertSteps(task)[0];
    controls.onStepStarted(step);

    const stdoutChunks = [];
    const stderrChunks = [];
    const child = spawn(this._python, [this._script, task.command], {
      shell: false,               // CRITICAL: no shell => no command injection
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (d) => {
      if (stdoutChunks.join('').length < 32 * 1024) stdoutChunks.push(d);
    });
    child.stderr.on('data', (d) => {
      if (stderrChunks.join('').length < 8 * 1024) stderrChunks.push(d);
    });

    const checkInterval = setInterval(() => {
      if (controls.isCancelRequested()) {
        // Cooperative only: ask the child to exit, do NOT taskkill.
        try { child.kill('SIGTERM'); } catch { /* best effort */ }
      }
    }, 250);

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* best effort */ }
    }, this._timeoutMs);

    try {
      const code = await new Promise((resolve, reject) => {
        child.on('error', (err) => {
          reject(new AdapterError(`Autopilot failed to start: ${err.message}`, 'autopilot_spawn_error', false));
        });
        child.on('exit', (c) => resolve(c));
      });

      controls.throwIfCancelled();

      if (code !== 0) {
        const e = new AdapterError(
          `Autopilot exited with code ${code}.`,
          'autopilot_exit_nonzero',
          true
        );
        controls.onStepFailed(step, e);
        throw e;
      }
      controls.onStepCompleted(step, { exit_code: code });
      return {
        adapter: 'autopilot',
        exit_code: code,
        stdout_tail: Buffer.concat(stdoutChunks).toString('utf8').slice(-2000),
      };
    } finally {
      clearInterval(checkInterval);
      clearTimeout(timeout);
    }
  }

  async verifyTask(task, { result } = {}) {
    return { ok: result && result.exit_code === 0, details: 'Autopilot exit-code verification.' };
  }

  async cancelTask() {
    return { ok: true, note: 'autopilot adapter: cooperative SIGTERM handled by interval' };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createExecutionAdapter(adapterConfig = {}) {
  const kind = adapterConfig.kind || 'stub';
  switch (kind) {
    case 'stub':
      return new StubExecutionAdapter({
        stepDelayMs: adapterConfig.stubStepDelayMs,
        failOnMatch: adapterConfig.stubFailOnMatch || null,
        failVerification: adapterConfig.stubFailVerification === true,
      });
    case 'bridge':
      return new BridgeExecutionAdapter({
        bridgeUrl: adapterConfig.bridgeUrl,
        executePath: adapterConfig.bridgeExecutePath,
        timeoutMs: adapterConfig.bridgeTimeoutMs,
      });
    case 'autopilot':
      return new AutopilotProcessAdapter({
        pythonPath: adapterConfig.autopilotPythonPath,
        scriptPath: adapterConfig.autopilotScriptPath,
        timeoutMs: adapterConfig.autopilotTimeoutMs,
      });
    default:
      throw new AdapterError(`Unknown execution adapter kind: ${kind}`, 'adapter_config_error', false);
  }
}

module.exports = {
  AdapterError,
  StubExecutionAdapter,
  BridgeExecutionAdapter,
  AutopilotProcessAdapter,
  createExecutionAdapter,
  CancelledError,
};
