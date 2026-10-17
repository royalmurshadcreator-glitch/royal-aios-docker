"use strict";

/*
 * ROYAL JARVIS — Agent Registry
 *
 * Central capability registry for Phase 2.
 *
 * The registry does not execute work.
 * It determines which agent is capable of handling a command.
 */

class AgentRegistry {

  constructor() {
    this.agents = new Map();
  }

  register(agent) {
    if (!agent || typeof agent !== "object") {
      throw new Error("Invalid agent.");
    }

    if (!agent.id || typeof agent.id !== "string") {
      throw new Error("Agent id is required.");
    }

    if (typeof agent.canHandle !== "function") {
      throw new Error(`Agent ${agent.id} requires canHandle().`);
    }

    if (typeof agent.execute !== "function") {
      throw new Error(`Agent ${agent.id} requires execute().`);
    }

    this.agents.set(agent.id, agent);
    return agent;
  }

  unregister(id) {
    return this.agents.delete(id);
  }

  get(id) {
    return this.agents.get(id) || null;
  }

  list() {
    return [...this.agents.values()];
  }

  capabilities() {
    return this.list().map(agent => ({
      id: agent.id,
      name: agent.name || agent.id,
      description: agent.description || "",
      capabilities: Array.isArray(agent.capabilities)
        ? [...agent.capabilities]
        : [],
      risk_level: agent.risk_level || "LEVEL_1",
      enabled: agent.enabled !== false
    }));
  }

  resolve(command, context = {}) {
    const candidates = [];

    for (const agent of this.list()) {
      if (agent.enabled === false) continue;

      let accepted = false;

      try {
        accepted = agent.canHandle(command, context) === true;
      } catch (_) {
        accepted = false;
      }

      if (accepted) {
        candidates.push(agent);
      }
    }

    candidates.sort((a, b) => {
      const ap = Number(a.priority || 100);
      const bp = Number(b.priority || 100);
      return ap - bp;
    });

    return candidates[0] || null;
  }

  resolveAll(command, context = {}) {
    return this.list()
      .filter(agent => agent.enabled !== false)
      .filter(agent => {
        try {
          return agent.canHandle(command, context) === true;
        } catch (_) {
          return false;
        }
      })
      .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100));
  }
}

function createAgentRegistry() {
  return new AgentRegistry();
}

module.exports = {
  AgentRegistry,
  createAgentRegistry
};
