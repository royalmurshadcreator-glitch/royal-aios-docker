'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — api-adapter.cjs
 *
 * Plain-http integration adapter for the EXISTING App/server.js.
 * No Express, no frameworks — works with node:http req/res objects.
 *
 * Integration contract (one line inside the existing request handler):
 *
 *   const orchestratorApi = createApiHandler(orchestrator);
 *   // ... inside your existing server's request handler, FIRST:
 *   if (await orchestratorApi(req, res)) return;  // orchestrator handled it
 *   // otherwise fall through to the legacy dashboard logic untouched
 *
 * Endpoints (basePath default '/api'):
 *   POST /api/autopilot                  submit a command
 *   GET  /api/tasks                      list tasks (?status=&limit=&offset=)
 *   GET  /api/tasks/:task_id             fetch one task
 *   POST /api/tasks/:task_id/cancel      cooperative cancel
 *   POST /api/tasks/:task_id/confirm     { "approved": true|false, "note"?: string }
 *   GET  /api/orchestrator/status        queue/registry/history health snapshot
 *
 * Safety:
 *   - Requests outside basePath are NOT handled (returns false).
 *   - JSON bodies are size-capped; malformed JSON -> 400, never a crash.
 *   - Task IDs are pattern-validated before use (no path traversal).
 *   - Errors returned to clients are safe: no stack traces, no host paths.
 */

const { isValidTaskId, ValidationError, safeErrorFields } = require('./validation.cjs');

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});

class HttpError extends Error {
  constructor(httpStatus, code, message) {
    super(message);
    this.name = 'HttpError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, JSON_HEADERS);
  res.end(body);
}

/** Read a JSON body with a hard byte cap. Never throws into the server. */
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        fail(new HttpError(413, 'payload_too_large', 'Request body exceeds the 64 KB limit.'));
        req.removeAllListeners('data');
        req.resume(); // drain
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid_json', 'Request body must be valid JSON.'));
      }
    });
    req.on('error', () => fail(new HttpError(400, 'request_error', 'Could not read request body.')));
  });
}

function parsePositiveInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

/**
 * Create the request handler bound to an Orchestrator instance.
 *
 * @param {import('./orchestrator.cjs').Orchestrator} orchestrator
 * @param {object} [options]
 * @param {string} [options.basePath='/api']
 * @param {number} [options.maxBodyBytes=65536]
 * @param {number} [options.maxListLimit=200]
 * @returns {(req, res) => Promise<boolean>} true when the request was handled
 */
function createApiHandler(orchestrator, options = {}) {
  if (!orchestrator) throw new Error('createApiHandler requires an orchestrator instance.');
  const basePath = (options.basePath || '/api').replace(/\/+$/, '');
  const maxBodyBytes = Math.max(1024, Number(options.maxBodyBytes) || 64 * 1024);
  const maxListLimit = Math.max(1, Number(options.maxListLimit) || 200);
  const logger = orchestrator.logger;

  return async function handleOrchestratorApi(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      return false;
    }
    const pathname = url.pathname;
    if (!pathname.startsWith(`${basePath}/`) && pathname !== basePath) {
      return false; // not ours — let the legacy server handle it
    }
    const method = (req.method || 'GET').toUpperCase();
    // Path segments after basePath, e.g. ['tasks', 'task_x', 'cancel']
    const segments = pathname
      .slice(basePath.length)
      .split('/')
      .filter(Boolean)
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });

    try {
      // --- POST /api/autopilot ---------------------------------------------
      if (method === 'POST' && segments.length === 1 && segments[0] === 'autopilot') {
        const body = await readJsonBody(req, maxBodyBytes);
        const { task } = await orchestrator.submitCommand({
          command: body.command,
          source: body.source,
          priority: body.priority,
          risk_level: body.risk_level,
          parent_task_id: body.parent_task_id,
          requires_confirmation: body.requires_confirmation,
          metadata: body.metadata,
        });
        sendJson(res, 202, {
          ok: true,
          task_id: task.task_id,
          status: task.status,
          requires_confirmation: task.requires_confirmation,
        });
        return true;
      }

      // --- GET /api/orchestrator/status -------------------------------------
      if (method === 'GET' && segments.length === 2 && segments[0] === 'orchestrator' && segments[1] === 'status') {
        sendJson(res, 200, { ok: true, orchestrator: orchestrator.getStats() });
        return true;
      }

      // --- /api/tasks --------------------------------------------------------
      if (segments[0] === 'tasks') {
        // GET /api/tasks
        if (method === 'GET' && segments.length === 1) {
          const limit = parsePositiveInt(url.searchParams.get('limit'), 50, 1, maxListLimit);
          const offset = parsePositiveInt(url.searchParams.get('offset'), 0, 0, 100000);
          const statusParam = url.searchParams.get('status');
          const filter = { limit, offset };
          if (statusParam) filter.status = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
          const source = url.searchParams.get('source');
          if (source) filter.source = source;
          const { tasks, total } = orchestrator.listTasks(filter);
          sendJson(res, 200, { ok: true, count: tasks.length, total, tasks });
          return true;
        }

        const taskId = segments[1];
        if (typeof taskId === 'string' && taskId.length > 0) {
          // Pattern-validate the id FIRST — blocks path traversal shapes.
          if (!isValidTaskId(taskId)) {
            throw new HttpError(400, 'invalid_task_id', 'Invalid task_id format.');
          }

          // GET /api/tasks/:task_id
          if (method === 'GET' && segments.length === 2) {
            const task = orchestrator.getTask(taskId);
            if (!task) throw new HttpError(404, 'task_not_found', 'Task not found.');
            // Full detail for a live task; compact record for history fallbacks.
            const payload = task.from_history === true
              ? task
              : JSON.parse(JSON.stringify(task));
            sendJson(res, 200, { ok: true, task: payload });
            return true;
          }

          // POST /api/tasks/:task_id/cancel
          if (method === 'POST' && segments.length === 3 && segments[2] === 'cancel') {
            const body = await readJsonBody(req, maxBodyBytes);
            const { task, note } = await orchestrator.cancelTask(taskId, body.reason);
            sendJson(res, 200, {
              ok: true,
              task_id: task.task_id,
              status: task.status,
              cancel_requested: task.cancel_requested,
              ...(note ? { note } : {}),
            });
            return true;
          }

          // POST /api/tasks/:task_id/confirm
          if (method === 'POST' && segments.length === 3 && segments[2] === 'confirm') {
            const body = await readJsonBody(req, maxBodyBytes);
            const { task } = await orchestrator.confirmTask(taskId, {
              approved: body.approved !== false,
              note: body.note,
              decided_by: body.decided_by,
            });
            sendJson(res, 200, {
              ok: true,
              task_id: task.task_id,
              status: task.status,
            });
            return true;
          }

          // POST /api/tasks/:task_id/retry
          if (method === 'POST' && segments.length === 3 && segments[2] === 'retry') {
            const { task } = orchestrator.retryTask(taskId);
            sendJson(res, 200, {
              ok: true,
              task_id: task.task_id,
              status: task.status,
              retry_count: task.retry_count,
            });
            return true;
          }
        }
        throw new HttpError(404, 'route_not_found', 'Unknown orchestrator route.');
      }

      throw new HttpError(404, 'route_not_found', 'Unknown orchestrator route.');
    } catch (err) {
      const status = Number.isInteger(err && err.httpStatus) ? err.httpStatus : 500;
      const safe = err instanceof HttpError || err instanceof ValidationError || status < 500
        ? { code: err.code || 'request_error', message: err.message }
        : safeErrorFields(err); // 5xx: strip everything identifiable
      if (status >= 500 && logger) {
        logger.error('api.internal_error', {
          url: pathname,
          method,
          error: { message: String(err && err.message).slice(0, 300), name: err && err.name },
        });
      }
      sendJson(res, status, { ok: false, error: safe });
      return true;
    }
  };
}

module.exports = { createApiHandler, HttpError };
