class JarvisBrain {
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.orchestrator = options.orchestrator || null;
    this.emergencyStop = options.emergencyStop || null;

    if (!this.registry) {
      throw new Error("JarvisBrain requires an AgentRegistry instance.");
    }
  }

  normalizeCommand(input) {
    if (typeof input !== "string") {
      throw new Error("Command must be a non-empty string.");
    }
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error("Command cannot be empty.");
    }
    return trimmed;
  }

  assertEmergencyStopNotEngaged() {
    if (this.emergencyStop && typeof this.emergencyStop.assertAllowed === "function") {
      this.emergencyStop.assertAllowed();
      return;
    }

    if (this.emergencyStop && typeof this.emergencyStop.isEngaged === "function") {
      if (this.emergencyStop.isEngaged()) {
        const error = new Error("Emergency Stop is engaged. Jarvis Brain operations are blocked.");
        error.code = "EMERGENCY_STOP_ENGAGED";
        error.status = 423;
        throw error;
      }
    }
  }

  analyze(input, context = {}) {
    this.assertEmergencyStopNotEngaged();    const raw = this.normalizeCommand(input);
    const lower = raw.toLowerCase();

    // Direct routing match against registered agents
    const agents = this.registry.list();
    let bestAgent = null;
    let highestScore = -1;

    for (const ag of agents) {
      const agentInstance = this.registry.get(ag.id);
      if (agentInstance && typeof agentInstance.canHandle === "function") {
        const score = agentInstance.canHandle(raw, context);
        if (score > highestScore) {
          highestScore = score;
          bestAgent = agentInstance;
        }
      }
    }

    // Default fallback to computer agent
    if (!bestAgent || highestScore <= 0) {
      bestAgent = this.registry.get("computer");
    }

    if (!bestAgent) {
      throw new Error("No suitable agent available in registry.");
    }

    return {
      raw_command: raw,
      command: raw,
      source: context.source || "text",
      metadata: context.metadata || {},
      agent: {
        id: bestAgent.id,
        name: bestAgent.name,
        risk_level: bestAgent.riskLevel || "LEVEL_1",
        capabilities: bestAgent.capabilities || []
      }
    };
  }

  async dispatch(input, context = {}) {
    this.assertEmergencyStopNotEngaged();

    const analysis = this.analyze(input, context);
    const agent = this.registry.get(analysis.agent.id);

    if (!agent) {
      throw new Error("Resolved agent disappeared before execution.");
    }

    // If agent handles locally or system read
    if (agent.id === "system" || agent.id === "voice" || agent.id === "vision" || !this.orchestrator) {
      const result = await agent.execute(analysis);
      return {
        ok: true,
        task_id: `direct_${agent.id}_${Date.now()}`,
        status: "COMPLETED",
        agent: agent.id,
        result
      };
    }

    // For computer, file, browser: submit to Orchestrator queue
    if (typeof this.orchestrator.submitCommand === "function") {
      const submission = await this.orchestrator.submitCommand({
        command: analysis.raw_command || input,
        source: context.source || "jarvis_brain",
        metadata: {
          agent_id: agent.id,
          analysis
        }
      });
      return {
        ok: true,
        task_id: submission.task ? submission.task.task_id : (submission.response ? submission.response.task_id : null),
        status: submission.task ? submission.task.status : "QUEUED",
        agent: agent.id,
        task: submission.task
      };
    }

    return agent.execute(analysis);
  }

  status() {
    return {
      online: true,
      registered_agents: this.registry.list().length,
      agents: this.registry.list().map(a => a.id),
      capabilities: this.registry.capabilities()
    };
  }
}

function createJarvisBrain(options = {}) {
  return new JarvisBrain(options);
}

module.exports = {
  JarvisBrain,
  createJarvisBrain
};
