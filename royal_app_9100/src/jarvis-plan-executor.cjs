const plansStore = new Map();

class JarvisPlanExecutor {
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.brain = options.brain || null;
    this.memory = options.memory || null;
    if (!this.registry) throw new Error("PlanExecutor requires registry");
  }

  storePlan(plan) {
    plansStore.set(plan.plan_id, plan);
    if (plansStore.size > 100) {
      const oldest = plansStore.keys().next().value;
      plansStore.delete(oldest);
    }
  }

  getPlan(planId) {
    return plansStore.get(planId) || null;
  }

  async executePlan(plan, options = {}) {
    plan.status = "EXECUTING";
    plan.started_at = new Date().toISOString();
    const startTime = Date.now();
    this.storePlan(plan);

    let stepsCompleted = 0;
    let stepsFailed = 0;

    for (const step of plan.steps) {
      step.status = "EXECUTING";
      step.started_at = new Date().toISOString();
      this.storePlan(plan);

      try {
        const agent = this.registry.get(step.agent);
        if (!agent) throw new Error(`Agent not found: ${step.agent}`);

        const analysis = {
          raw_command: step.command,
          command: step.command,
          source: "planner",
          metadata: { plan_id: plan.plan_id, step: step.step },
          agent: {
            id: agent.id,
            name: agent.name,
            risk_level: agent.riskLevel || "LEVEL_1",
            capabilities: agent.capabilities || []
          }
        };

        let result;
        if (["system", "voice", "vision"].includes(agent.id)) {
          result = await agent.execute(analysis);
        } else if (this.brain && typeof this.brain.dispatch === "function") {
          result = await this.brain.dispatch(step.command, { source: "planner" });
        } else {
          result = await agent.execute(analysis);
        }

        step.status = "COMPLETED";
        step.result = result;
        step.completed_at = new Date().toISOString();
        stepsCompleted++;
      } catch (e) {
        step.status = "FAILED";
        step.error = e.message;
        step.completed_at = new Date().toISOString();
        stepsFailed++;
        plan.status = "FAILED";
        plan.error = `Step ${step.step} failed: ${e.message}`;
        this.storePlan(plan);
        break;
      }

      this.storePlan(plan);
    }

    if (plan.status !== "FAILED") {
      plan.status = "COMPLETED";
    }
    plan.completed_at = new Date().toISOString();
    this.storePlan(plan);

    // Log execution to memory
    if (this.memory && typeof this.memory.logExecution === "function") {
      try {
        this.memory.logExecution({
          goal: plan.goal,
          plan_id: plan.plan_id,
          status: plan.status,
          steps_completed: stepsCompleted,
          steps_failed: stepsFailed,
          duration_ms: Date.now() - startTime,
          error: plan.error || null
        });
      } catch (_) {}
    }

    return plan;
  }
}

function createPlanExecutor(options) {
  return new JarvisPlanExecutor(options);
}

module.exports = { JarvisPlanExecutor, createPlanExecutor };
