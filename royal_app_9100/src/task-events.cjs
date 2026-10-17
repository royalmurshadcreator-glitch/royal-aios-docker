'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR — task-events.cjs
 *
 * Internal task event bus.
 *
 * These events are the future feed for:
 *   - Dashboard Activity stream
 *   - App/data/notifications.json writers
 *   - Logs / Memory integration
 *
 * Design rules:
 *   - A throwing listener must NEVER break the orchestrator.
 *   - Envelopes are small, stable, JSON-serializable objects.
 */

const { EventEmitter } = require('node:events');
const { nowIso } = require('./task-model.cjs');

const EVENT_TYPES = Object.freeze({
  CREATED: 'task.created',
  QUEUED: 'task.queued',
  STARTED: 'task.started',
  STEP_STARTED: 'task.step_started',
  STEP_COMPLETED: 'task.step_completed',
  VERIFICATION_STARTED: 'task.verification_started',
  VERIFICATION_COMPLETED: 'task.verification_completed',
  COMPLETED: 'task.completed',
  FAILED: 'task.failed',
  CANCELLED: 'task.cancelled',
  CONFIRMATION_REQUIRED: 'task.confirmation_required',
});

const WILDCARD = '*';

class TaskEvents extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {(err:Error, envelope:object)=>void} [options.onListenerError]
   */
  constructor(options = {}) {
    super();
    this.setMaxListeners(50);
    this._onListenerError = typeof options.onListenerError === 'function'
      ? options.onListenerError
      : null;
  }

  /**
   * Emit a task event to listeners of <type> and to wildcard ('*') listeners.
   * Listener exceptions are captured and routed to onListenerError.
   */
  emitEvent(type, task, extra = {}) {
    const envelope = {
      type,
      at: nowIso(),
      task_id: task && typeof task.task_id === 'string' ? task.task_id : null,
      status: task && typeof task.status === 'string' ? task.status : null,
      ...extra,
    };
    const deliver = (listener) => {
      try {
        listener(envelope);
      } catch (err) {
        if (this._onListenerError) {
          try { this._onListenerError(err, envelope); } catch { /* never throw from bus */ }
        }
      }
    };
    for (const l of this.listeners(type)) deliver(l);
    for (const l of this.listeners(WILDCARD)) deliver(l);
    return envelope;
  }

  /** Subscribe. Returns an unsubscribe function. */
  subscribe(type, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Event listener must be a function.');
    }
    this.on(type, listener);
    return () => this.unsubscribe(type, listener);
  }

  unsubscribe(type, listener) {
    this.removeListener(type, listener);
  }
}

module.exports = { TaskEvents, EVENT_TYPES, WILDCARD };
