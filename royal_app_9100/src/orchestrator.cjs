'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR â€” orchestrator.cjs
 *
 * The task orchestration core (BUILD #1).
 *
 * Pipeline position:
 *
 *   DASHBOARD / VOICE / FUTURE GESTURES
 *     -> COMMAND NORMALIZATION + VALIDATION   (validation.cjs)
 *     -> RISK CLASSIFICATION                  (risk-classifier.cjs)
 *     -> TASK ORCHESTRATOR  <-- THIS FILE
 *     -> TASK QUEUE                           (task-queue.cjs)
 *     -> EXECUTION ADAPTER -> existing Royal Jarvis systems
 *     -> VERIFICATION
 *     -> MEMORY / TASK HISTORY                (task-history.cjs)
 *
 * Guarantees:
 *   - Explicit, logged, guarded state transitions only.
 *   - LEVEL_2/LEVEL_3 work cannot execute without explicit confirmation.
 *   - Cooperative cancellation between steps; no force-killing.
 *   - Bounded retries (config.maxRetries; auto-retry OFF by default).
 *   - Hardware-aware: default concurrency 1 on CPU-only machines.
 */

const { createConfig } = require('./config.cjs');
const TaskModel = require('./task-model.cjs');
const {
  TASK_STATUS,
  STEP_STATUS,
  VERIFICATION_STATUS,
  createStep,
  touchTask,
  isTerminal,
  serializeTask,
  summarizeTask,
} = TaskModel;
const { TaskQueue } = require('./task-queue.cjs');
const { TaskRegistry } = require('./task-registry.cjs');
const { TaskEvents, EVENT_TYPES } = require('./task-events.cjs');
const { TaskHistory } = require('./task-history.cjs');
const { TaskLogger } = require('./task-logger.cjs');
const { ConfirmationManager } = require('./confirmation.cjs');
const { CancellationController, CancelledError } = require('./cancellation.cjs');
const { applyTransition, canTransition, TransitionError } = require('./task-state-machine.cjs');
const { classifyRisk, isHigherRisk } = require('./risk-classifier.cjs');
const { createExecutionAdapter, AdapterError } = require('./execution-adapter.cjs');
const { writeEpisode } = require('./memory-writer.cjs');
const {
  ValidationError,
  assertCommand,
  assertSource,
  assertPriority,
  normalizeRiskLevel,
  isValidTaskId,
  assertTaskId,
  sanitizeMetadata,
  safeErrorFields,
} = require('./validation.cjs');

class OrchestratorError extends Error {
  constructor(message, code = 'orchestrator_error', httpStatus = 409) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

class Orchestrator {
  /**
   * @param {object} [options] - config overrides + dependency injection
   * @param {string} [options.dataDir]      production: D:\01_ROYAL_JARVIS\App\data
   * @param {object} [options.adapter]      pre-built adapter INSTANCE (must expose
   *                                        planTask/executeTask/verifyTask/cancelTask).
   *                                        If a plain config object is passed instead
   *                                        (e.g. { kind:'bridge' }) it is merged into
   *                                        options.adapterConfig.
   * @param {object} [options.adapterConfig] adapter settings ({ kind, bridgeUrl, ... })
   * @param {object} [options.config]        nested config overrides (createConfig shape)
   * @param {TaskEvents} [options.events]    pre-built event bus
   * @param {TaskLogger} [options.logger]    pre-built logger
   */
  constructor(options = {}) {
    const { adapter, adapterConfig, events, logger, config, ...flatOverrides } = options;
    const looksLikeInstance = adapter && typeof adapter.planTask === 'function';
    this.config = createConfig({
      ...flatOverrides,
      ...(config && typeof config === 'object' ? config : {}),
      adapter: {
        ...((config && config.adapter) || {}),
        ...(adapterConfig || {}),
        ...(adapter && !looksLikeInstance && typeof adapter === 'object' ? adapter : {}),
      },
    });
    this._startedAt = TaskModel.nowIso();
    this._shutdown = false;
    this._pendingRetries = new Map(); // task_id -> timeout handle

    this.logger = logger || new TaskLogger({
      logDir: this.config.logDir,
      fileName: this.config.logFileName,
      maxBytes: this.config.logMaxBytes,
      maxFiles: this.config.logMaxFiles,
    });
    this.events = events || new TaskEvents({
      onListenerError: (err, envelope) => {
        this.logger.error('event.listener_error', {
          error: { message: String(err && err.message).slice(0, 200) },
          event_type: envelope && envelope.type,
        });
      },
    });
    this.registry = new TaskRegistry({ maxTasks: this.config.registryMaxTasks });
    this.queue = new TaskQueue({ maxConcurrency: this.config.maxConcurrency });
    this.history = new TaskHistory({
      filePath: this.config.historyFile,
      maxRecords: this.config.historyMaxRecords,
      prettyPrint: this.config.historyPrettyPrint,
      logger: { warn: (m) => this.logger.warn('history.warning', { detail: m }) },
    });
    this.confirmations = new ConfirmationManager();
    this.cancellations = new CancellationController();
    this.adapter = looksLikeInstance ? adapter : createExecutionAdapter(this.config.adapter);

    if (this.history.wasRecoveredFromCorruption()) {
      this.logger.warn('history.recovered_from_corruption', { file: '<tasks.json>' });
    }
    this.logger.info('orchestrator.initialized', {
      adapter: this.adapter.kind || 'custom',
      max_concurrency: this.config.maxConcurrency,
      auto_retry: this.config.autoRetry,
    });
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------

  /** Subscribe to task events. Returns unsubscribe function. */
  on(type, listener) {
    return this.events.subscribe(type, listener);
  }

  /**
   * Submit a normalized command as a new task.
   *
   * @param {object} input
   * @param {string} input.command        (required)
   * @param {string} [input.source]       e.g. 'dashboard' | 'voice' | 'api'
   * @param {number} [input.priority]     0 = highest
   * @param {string} [input.risk_level]   caller may RAISE risk, never lower it
   * @param {string} [input.parent_task_id]
   * @param {object} [input.metadata]
   * @returns {Promise<{task: object, response: {task_id, status, requires_confirmation}}>}
   */
  async submitCommand(input = {}) {
    this._assertRunning();
    const command = assertCommand(input.command, this.config.maxCommandLength);
    const source = assertSource(input.source);
    const priority = assertPriority(input.priority, {
      defaultPriority: this.config.defaultPriority,
      maxPriority: this.config.maxPriority,
    });
    let parentTaskId = null;
    if (input.parent_task_id !== undefined && input.parent_task_id !== null) {
      assertTaskId(input.parent_task_id, 'parent_task_id');
      parentTaskId = input.parent_task_id;
    }
    const metadata = sanitizeMetadata(input.metadata);

    // --- Risk classification (fail-closed, never downgradable by caller) ---
    const classified = classifyRisk(command, { defaultLevel: this.config.defaultRiskLevel });
    let riskLevel = classified.level;
    const requestedLevel = normalizeRiskLevel(input.risk_level);
    if (input.risk_level !== undefined && input.risk_level !== null && !requestedLevel) {
      throw new ValidationError('Invalid risk_level value.', 'risk_level', 'invalid_risk_level');
    }
    if (requestedLevel && isHigherRisk(requestedLevel, riskLevel)) riskLevel = requestedLevel;

    const requiresConfirmation = this.confirmations.requiresConfirmation(
      riskLevel,
      input.requires_confirmation === true,
      this.config.confirmationRequiredFor
    );

    metadata.risk = { classified_as: classified.level, reason: classified.reason };

    // --- Create + register -------------------------------------------------
    const task = TaskModel.createTask({
      command,
      source,
      priority,
      risk_level: riskLevel,
      requires_confirmation: requiresConfirmation,
      parent_task_id: parentTaskId,
      max_retries: this.config.maxRetries,
      metadata,
    });
    this.registry.createTask(task);
    this.events.emitEvent(EVENT_TYPES.CREATED, task, {
      risk_level: task.risk_level,
      source: task.source,
    });
    this.logger.info('task.created', {
      task_id: task.task_id,
      source: task.source,
      risk_level: task.risk_level,
      priority: task.priority,
    });
    this.history.recordTask(task);

    // --- Plan --------------------------------------------------------------
    const planned = await this._plan(task);
    if (!planned) {
      return { task, response: this._submissionResponse(task) };
    }

    // --- Confirmation gate (BEFORE queueing â€” never bypassed) ---------------
    if (requiresConfirmation) {
      this._toWaitingConfirmation(task, 'risk_gate');
      return { task, response: this._submissionResponse(task) };
    }

    // --- Queue --------------------------------------------------------------
    this._enqueue(task, 'submitted');
    return { task, response: this._submissionResponse(task) };
  }

  /**
   * Confirm (approve) or reject a task held in WAITING_CONFIRMATION.
   * @param {string} taskId
   * @param {{approved?: boolean, note?: string, decided_by?: string}} [decision]
   */
  async confirmTask(taskId, decision = {}) {
    this._assertRunning();
    assertTaskId(taskId);
    const task = this.registry.getTask(taskId);
    if (!task) throw new OrchestratorError('Task not found.', 'task_not_found', 404);
    if (task.status !== TASK_STATUS.WAITING_CONFIRMATION) {
      throw new OrchestratorError(
        `Task is not waiting for confirmation (status: ${task.status}).`,
        'invalid_state',
        409
      );
    }

    const approved = decision.approved !== false; // default = approve
    const note = typeof decision.note === 'string' ? decision.note.slice(0, 200) : null;
    const decidedBy = typeof decision.decided_by === 'string' ? decision.decided_by.slice(0, 64) : 'user';

    if (approved) {
      this.confirmations.approve(taskId, note);
      task.metadata.confirmation = {
        status: 'approved',
        decided_at: TaskModel.nowIso(),
        decided_by: decidedBy,
        note,
      };
      touchTask(task);
      this.logger.info('task.confirmation_approved', { task_id: taskId });
      this._enqueue(task, 'confirmed');
      this.history.recordTask(task);
      return { task };
    }

    this.confirmations.reject(taskId, note);
    task.metadata.confirmation = {
      status: 'rejected',
      decided_at: TaskModel.nowIso(),
      decided_by: decidedBy,
      note,
    };
    task.metadata.cancel_reason = 'confirmation_rejected';
    this._transition(task, TASK_STATUS.CANCELLED, 'confirmation_rejected');
    this.history.recordTask(task);
    this.logger.info('task.confirmation_rejected', { task_id: taskId });
    this.events.emitEvent(EVENT_TYPES.CANCELLED, task, { reason: 'confirmation_rejected' });
    return { task };
  }

  /**
   * Cooperative cancellation.
   *   - waiting/queued tasks transition to CANCELLED immediately
   *   - executing tasks get cancel_requested=true; execution stops at the
   *     next step boundary (adapters never get force-killed here)
   */
  async cancelTask(taskId, reason) {
    this._assertRunning();
    assertTaskId(taskId);
    const task = this.registry.getTask(taskId);
    if (!task) throw new OrchestratorError('Task not found.', 'task_not_found', 404);

    if (isTerminal(task)) {
      return { task, note: 'already_terminal' };
    }

    task.cancel_requested = true;
    task.metadata.cancel_reason = typeof reason === 'string' ? reason.slice(0, 200) : 'user_requested';
    touchTask(task);
    this.cancellations.request(taskId);

    // Clear a scheduled auto-retry first, if any.
    const pendingTimer = this._pendingRetries.get(taskId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this._pendingRetries.delete(taskId);
    }

    switch (task.status) {
      case TASK_STATUS.CREATED:
      case TASK_STATUS.PLANNED:
      case TASK_STATUS.WAITING_CONFIRMATION: {
        this.confirmations.clear(taskId);
        this._transition(task, TASK_STATUS.CANCELLED, 'cancelled_before_queue');
        break;
      }
      case TASK_STATUS.QUEUED: {
        this.queue.removeTask(taskId);
        this._transition(task, TASK_STATUS.CANCELLED, 'cancelled_in_queue');
        break;
      }
      case TASK_STATUS.RECOVERING: {
        this._transition(task, TASK_STATUS.CANCELLED, 'cancelled_while_recovering');
        break;
      }
      case TASK_STATUS.EXECUTING:
      case TASK_STATUS.VERIFYING: {
        // Cooperative path: executor observes the flag between steps.
        this.logger.info('task.cancellation_requested', { task_id: taskId, status: task.status });
        if (this.adapter && typeof this.adapter.cancelTask === 'function') {
          try {
            await this.adapter.cancelTask(task);
          } catch (err) {
            this.logger.warn('task.adapter_cancel_signal_failed', {
              task_id: taskId,
              error: String(err && err.message).slice(0, 200),
            });
          }
        }
        return { task, note: 'cancellation_requested' };
      }
      default:
        break;
    }

    this.cancellations.clear(taskId);
    this.history.recordTask(task);
    this.events.emitEvent(EVENT_TYPES.CANCELLED, task, { reason: task.metadata.cancel_reason });
    return { task };
  }

  /**
   * Controlled manual retry of a FAILED task. Bounded by task.max_retries.
   * Aggressive automatic recovery is intentionally NOT enabled by default.
   */
  retryTask(taskId) {
    this._assertRunning();
    assertTaskId(taskId);
    const task = this.registry.getTask(taskId);
    if (!task) throw new OrchestratorError('Task not found.', 'task_not_found', 404);
    if (task.status !== TASK_STATUS.FAILED) {
      throw new OrchestratorError(
        `Only FAILED tasks can be retried (status: ${task.status}).`,
        'invalid_state',
        409
      );
    }
    if (task.retry_count >= task.max_retries) {
      throw new OrchestratorError(
        `Retry limit reached (${task.retry_count}/${task.max_retries}).`,
        'max_retries_exceeded',
        409
      );
    }
    task.retry_count += 1;
    this.logger.info('task.retry', {
      task_id: taskId,
      retry_count: task.retry_count,
      max_retries: task.max_retries,
    });
    this._resetForRerun(task);
    this._transition(task, TASK_STATUS.QUEUED, 'manual_retry');
    this.queue.enqueueTask(task);
    this.events.emitEvent(EVENT_TYPES.QUEUED, task, { reason: 'manual_retry', retry_count: task.retry_count });
    this.history.recordTask(task);
    this._pump();
    return { task };
  }

  /**
   * Fetch a task. Registry (live + recent) first, then durable history.
   * @returns {object|null}
   */
  getTask(taskId) {
    if (!isValidTaskId(taskId)) return null;
    const live = this.registry.getTask(taskId);
    if (live) return live;
    const record = this.history.getRecord(taskId);
    if (record) return { ...record, from_history: true };
    return null;
  }

  /** @param {{status?: string|string[], source?: string, limit?: number, offset?: number}} [filter] */
  listTasks(filter = {}) {
    const { tasks, total } = this.registry.listTasks(filter);
    return { tasks: tasks.map(summarizeTask), total };
  }

  getQueueSnapshot() {
    return {
      waiting: this.queue.getQueue(),
      waiting_count: this.queue.sizeWaiting,
      active_count: this.queue.getActiveCount(),
      max_concurrency: this.queue.maxConcurrency,
    };
  }

  getStats() {
    return {
      started_at: this._startedAt,
      shutdown: this._shutdown,
      adapter: this.adapter.kind || 'custom',
      counts: this.registry.countByStatus(),
      queue: {
        waiting: this.queue.sizeWaiting,
        active: this.queue.getActiveCount(),
        max_concurrency: this.queue.maxConcurrency,
      },
      confirmations_pending: this.confirmations.listPending().length,
      history: this.history.stats(),
      safety: {
        max_retries: this.config.maxRetries,
        auto_retry: this.config.autoRetry,
        confirmation_required_for: [...this.config.confirmationRequiredFor],
      },
    };
  }

  /**
   * Graceful shutdown: stop scheduling, clear pending retry timers, request
   * cooperative cancellation of anything still executing. Never force-kills.
   */
  async shutdown() {
    this._shutdown = true;
    for (const timer of this._pendingRetries.values()) clearTimeout(timer);
    this._pendingRetries.clear();
    for (const task of this.registry.listTasks({ limit: 1000 }).tasks) {
      if (task.status === TASK_STATUS.EXECUTING || task.status === TASK_STATUS.VERIFYING) {
        task.cancel_requested = true;
        this.cancellations.request(task.task_id);
        if (this.adapter && typeof this.adapter.cancelTask === 'function') {
          try { await this.adapter.cancelTask(task); } catch { /* best effort */ }
        }
      }
    }
    this.logger.info('orchestrator.shutdown', { pending_retries_cleared: true });
  }

  // ------------------------------------------------------------------------
  // Internal pipeline
  // ------------------------------------------------------------------------

  _assertRunning() {
    if (this._shutdown) {
      throw new OrchestratorError('Orchestrator is shut down.', 'orchestrator_shutdown', 503);
    }
  }

  _submissionResponse(task) {
    return {
      task_id: task.task_id,
      status: task.status,
      requires_confirmation: task.requires_confirmation,
    };
  }

  /** Plan via adapter; on failure the task transitions to FAILED. */
  async _plan(task) {
    try {
      const plan = await this.adapter.planTask(task);
      const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];
      const steps = rawSteps.slice(0, this.config.maxStepsPerTask);
      task.steps = (steps.length > 0 ? steps : [{ name: 'execute_command' }]).map((s, i) => createStep(s, i));
      task.total_steps = task.steps.length;
      this._transition(task, TASK_STATUS.PLANNED, 'planned');
      this.logger.info('task.planned', { task_id: task.task_id, total_steps: task.total_steps });
      return true;
    } catch (err) {
      task.error = safeErrorFields(err, 'planning_failed');
      touchTask(task);
      this._transition(task, TASK_STATUS.FAILED, 'planning_failed');
      this.history.recordTask(task);
      this.events.emitEvent(EVENT_TYPES.FAILED, task, { error: task.error, phase: 'planning' });
      this.logger.error('task.planning_failed', { task_id: task.task_id, error: task.error });
      return false;
    }
  }

  _toWaitingConfirmation(task, reason) {
    this.confirmations.requestConfirmation(task, reason);
    task.metadata.confirmation = {
      status: 'pending',
      requested_at: TaskModel.nowIso(),
      note: reason,
    };
    this._transition(task, TASK_STATUS.WAITING_CONFIRMATION, reason);
    this.events.emitEvent(EVENT_TYPES.CONFIRMATION_REQUIRED, task, {
      risk_level: task.risk_level,
      reason,
    });
    this.logger.info('task.confirmation_required', { task_id: task.task_id, risk_level: task.risk_level });
    this.history.recordTask(task);
  }

  _enqueue(task, reason) {
    if (task.status !== TASK_STATUS.QUEUED) {
      this._transition(task, TASK_STATUS.QUEUED, reason);
    }
    this.queue.enqueueTask(task);
    this.events.emitEvent(EVENT_TYPES.QUEUED, task, {
      reason,
      priority: task.priority,
      queue_depth: this.queue.sizeWaiting,
    });
    this.logger.info('task.queued', { task_id: task.task_id, priority: task.priority });
    this.history.recordTask(task);
    this._pump();
  }

  /**
   * Scheduling loop. Synchronous; launches asynchronous task runners.
   * Concurrency is hard-capped by the queue â€” on the target hardware
   * (CPU-only Ollama) the default cap is 1.
   */
  _pump() {
    if (this._shutdown) return;
    for (;;) {
      const task = this.queue.getNextTask();
      if (!task) return; // empty queue or at concurrency capacity

      // Defense-in-depth: never execute unconfirmed risky work.
      if (task.requires_confirmation && !this.confirmations.isApproved(task.task_id)) {
        if (canTransition(task.status, TASK_STATUS.WAITING_CONFIRMATION)) {
          this.queue.releaseTask(task.task_id);
          this._toWaitingConfirmation(task, 'execution_gate');
          continue;
        }
      }

      // Pre-flight cancellation check.
      if (task.cancel_requested || this.cancellations.isRequested(task.task_id)) {
        this.queue.releaseTask(task.task_id);
        this.cancellations.clear(task.task_id);
        if (canTransition(task.status, TASK_STATUS.CANCELLED)) {
          this._transition(task, TASK_STATUS.CANCELLED, 'cancelled_before_start');
          this.history.recordTask(task);
          this.events.emitEvent(EVENT_TYPES.CANCELLED, task, { reason: 'cancelled_before_start' });
        }
        continue;
      }

      // Launch on the next tick, without awaiting: capacity is governed by
      // the queue's active-task gate. Scheduling on setImmediate keeps
      // submission responses deterministic (status QUEUED) and prevents
      // re-entrancy inside the caller's stack frame.
      setImmediate(() => {
        if (this._shutdown) {
          this.queue.releaseTask(task.task_id);
          if (canTransition(task.status, TASK_STATUS.CANCELLED)) {
            this._transition(task, TASK_STATUS.CANCELLED, 'orchestrator_shutdown');
            this.history.recordTask(task);
            this.events.emitEvent(EVENT_TYPES.CANCELLED, task, { reason: 'orchestrator_shutdown' });
          }
          return;
        }
        void this._runTask(task).catch((err) => {
          // Last-resort containment: _runTask handles all known failure paths.
          this.logger.error('orchestrator.unhandled_runner_error', {
            task_id: task.task_id,
            error: String(err && err.message).slice(0, 300),
          });
        });
      });
    }
  }

  _buildControls(task) {
    const cancelHandle = this.cancellations.createHandle(task.task_id, () => task.cancel_requested === true);
    const terminalGuard = () => isTerminal(task);
    return {
      isCancelRequested: () => cancelHandle.isCancelRequested(),
      throwIfCancelled: () => cancelHandle.throwIfCancelled(),
      onStepStarted: (step) => {
        if (terminalGuard() || !step) return;
        step.status = STEP_STATUS.RUNNING;
        step.started_at = TaskModel.nowIso();
        task.current_step = (step.index ?? 0) + 1;
        touchTask(task);
        this.events.emitEvent(EVENT_TYPES.STEP_STARTED, task, {
          step_index: step.index,
          step_name: step.name,
          current_step: task.current_step,
          total_steps: task.total_steps,
        });
      },
      onStepCompleted: (step, info) => {
        if (terminalGuard() || !step) return;
        step.status = STEP_STATUS.COMPLETED;
        step.completed_at = TaskModel.nowIso();
        touchTask(task);
        this.events.emitEvent(EVENT_TYPES.STEP_COMPLETED, task, {
          step_index: step.index,
          step_name: step.name,
          current_step: task.current_step,
          total_steps: task.total_steps,
          info: info && typeof info === 'object' ? info : undefined,
        });
      },
      onStepFailed: (step, err) => {
        if (terminalGuard() || !step) return;
        step.status = STEP_STATUS.FAILED;
        step.completed_at = TaskModel.nowIso();
        step.error = safeErrorFields(err, 'step_failed');
        touchTask(task);
      },
      log: (event, fields) => this.logger.info(event, { task_id: task.task_id, ...(fields || {}) }),
    };
  }

  async _runTask(task) {
    const controls = this._buildControls(task);
    try {
      // --- EXECUTING -------------------------------------------------------
      this._transition(task, TASK_STATUS.EXECUTING, 'execution_started');
      this.events.emitEvent(EVENT_TYPES.STARTED, task, { total_steps: task.total_steps });
      this.history.recordTask(task);

      const result = await this._withTimeout(
        () => this.adapter.executeTask(task, controls),
        this.config.taskTimeoutMs,
        task
      );

      controls.throwIfCancelled(); // cancellation may land on the final step

      // --- VERIFYING -------------------------------------------------------
      this._transition(task, TASK_STATUS.VERIFYING, 'verification_started');
      this.events.emitEvent(EVENT_TYPES.VERIFICATION_STARTED, task, {});
      const verification = await this.adapter.verifyTask(task, { result });
      const verifyOk = !verification || verification.ok !== false;
      task.verification_status = verifyOk
        ? VERIFICATION_STATUS.PASSED
        : VERIFICATION_STATUS.FAILED;
      touchTask(task);
      this.events.emitEvent(EVENT_TYPES.VERIFICATION_COMPLETED, task, {
        ok: verifyOk,
        details: verification && verification.details ? String(verification.details).slice(0, 200) : null,
      });
      if (!verifyOk && this.config.verificationStrict) {
        const err = new AdapterError('Task verification failed.', 'verification_failed', false);
        err.details = verification ? verification.details : null;
        throw err;
      }
      controls.throwIfCancelled(); // honor cancellation that landed during verification

      // --- COMPLETED ---------------------------------------------------------
      task.result = this._sanitizeResult(result);
      this._transition(task, TASK_STATUS.COMPLETED, 'completed');
      this.events.emitEvent(EVENT_TYPES.COMPLETED, task, {
        duration_ms: Date.parse(task.completed_at) - Date.parse(task.started_at),
      });
      this.logger.info('task.completed', { task_id: task.task_id });
      // --- memory-writer-on-completed ---
      try {
        writeEpisode({
          agent: (task.metadata && task.metadata.agent) || task.agent || 'orchestrator',
          command: task.command,
          taskId: task.task_id,
          success: true,
          result: task.result && (task.result.final_response || task.result.stdout_tail || JSON.stringify(task.result).slice(0, 500)),
          source: task.source || null,
          extra: { duration_ms: Date.parse(task.completed_at) - Date.parse(task.started_at) },
        });
      } catch (e) { this.logger.warn('memory_write_failed', { err: String(e && e.message || e) }); }
      this.history.recordTask(task);
      this.cancellations.clear(task.task_id);
    } catch (err) {
      await this._handleRunFailure(task, err, controls);
    } finally {
      this.queue.releaseTask(task.task_id);
      this._pump();
    }
  }

  async _handleRunFailure(task, err, controls) {
    const wasCancelled =
      err instanceof CancelledError ||
      (err && err.code === 'task_cancelled') ||
      task.cancel_requested === true ||
      this.cancellations.isRequested(task.task_id);

    if (wasCancelled) {
      this._markPendingStepsSkipped(task);
      if (canTransition(task.status, TASK_STATUS.CANCELLED)) {
        this._transition(task, TASK_STATUS.CANCELLED, 'cancelled_during_execution');
      }
      this.cancellations.clear(task.task_id);
      this.events.emitEvent(EVENT_TYPES.CANCELLED, task, { reason: task.metadata.cancel_reason || 'cancelled' });
      this.logger.info('task.cancelled', { task_id: task.task_id });
      this.history.recordTask(task);
      return;
    }

    const safe = safeErrorFields(err, 'execution_failed');
    task.error = { ...safe, retryable: err && err.retryable === true };
    touchTask(task);

    // Bounded automatic retry â€” only when explicitly enabled in config.
    const mayAutoRetry =
      this.config.autoRetry === true &&
      (err == null || err.retryable !== false) &&
      task.retry_count < task.max_retries;

    if (mayAutoRetry && canTransition(task.status, TASK_STATUS.RECOVERING)) {
      task.retry_count += 1;
      this._transition(task, TASK_STATUS.RECOVERING, `auto_retry_${task.retry_count}`);
      this.logger.warn('task.recovering', {
        task_id: task.task_id,
        retry_count: task.retry_count,
        error: safe,
      });
      this.history.recordTask(task);
      const timer = setTimeout(() => {
        this._pendingRetries.delete(task.task_id);
        if (this._shutdown || isTerminal(task)) return;
        if (task.cancel_requested || this.cancellations.isRequested(task.task_id)) {
          if (canTransition(task.status, TASK_STATUS.CANCELLED)) {
            this._transition(task, TASK_STATUS.CANCELLED, 'cancelled_while_recovering');
            this.cancellations.clear(task.task_id);
            this.events.emitEvent(EVENT_TYPES.CANCELLED, task, { reason: 'cancelled_while_recovering' });
            this.history.recordTask(task);
          }
          return;
        }
        this._resetForRerun(task);
        this._enqueue(task, `auto_retry_${task.retry_count}`);
      }, this.config.retryDelayMs);
      this._pendingRetries.set(task.task_id, timer);
      if (typeof timer.unref === 'function') timer.unref();
      return;
    }

    if (canTransition(task.status, TASK_STATUS.FAILED)) {
      this._transition(task, TASK_STATUS.FAILED, 'execution_failed');
    } else {
      task.status = TASK_STATUS.FAILED; // containment: never leave a task hanging
      touchTask(task);
    }
    this._markPendingStepsSkipped(task);
    this.events.emitEvent(EVENT_TYPES.FAILED, task, { error: task.error });
    this.logger.error('task.failed', { task_id: task.task_id, error: task.error });
      // --- memory-writer-on-failed ---
      try {
        writeEpisode({
          agent: (task.metadata && task.metadata.agent) || task.agent || 'orchestrator',
          command: task.command,
          taskId: task.task_id,
          success: false,
          error: task.error && (task.error.message || JSON.stringify(task.error).slice(0, 300)),
          source: task.source || null,
          extra: { retry_count: task.retry_count || 0 },
        });
      } catch (e) { this.logger.warn('memory_write_failed', { err: String(e && e.message || e) }); }
    this.history.recordTask(task);
    this.cancellations.clear(task.task_id);
  }

  _markPendingStepsSkipped(task) {
    if (!Array.isArray(task.steps)) return;
    for (const step of task.steps) {
      if (step.status === STEP_STATUS.PENDING || step.status === STEP_STATUS.RUNNING) {
        step.status = STEP_STATUS.SKIPPED;
        step.completed_at = step.completed_at || TaskModel.nowIso();
      }
    }
    touchTask(task);
  }

  _resetForRerun(task) {
    task.error = null;
    task.result = null;
    task.current_step = 0;
    task.verification_status = VERIFICATION_STATUS.PENDING;
    task.cancel_requested = false;
    task.completed_at = null;
    if (Array.isArray(task.steps)) {
      for (const step of task.steps) {
        step.status = STEP_STATUS.PENDING;
        step.started_at = null;
        step.completed_at = null;
        step.error = null;
      }
    }
    touchTask(task);
  }

  /** Apply a legal transition + log it. Throws TransitionError when illegal. */
  _transition(task, to, reason) {
    const record = applyTransition(task, to, reason);
    this.logger.info('task.transition', {
      task_id: task.task_id,
      from: record.from,
      to: record.to,
      reason: reason || null,
    });
    return record;
  }

  /** Race adapter work against the per-task timeout ceiling. */
  async _withTimeout(fn, ms, task) {
    let timer = null;
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new AdapterError(`Task exceeded time budget of ${ms}ms.`, 'task_timeout', true));
          }, ms);
          if (timer && typeof timer.unref === 'function') timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  _sanitizeResult(result) {
    if (result === undefined || result === null) return null;
    try {
      const s = JSON.stringify(result);
      if (s === undefined) return null;
      if (s.length > 8192) return { truncated: true, preview: s.slice(0, 1000) };
      return result;
    } catch {
      return { truncated: true, preview: '[unserializable result]' };
    }
  }
}

module.exports = { Orchestrator, OrchestratorError, EVENT_TYPES, TASK_STATUS, TransitionError };
