const http = require("http");

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const MODEL = "qwen2.5:3b";

const PLANNER_PROMPT = `You are JARVIS Planner. Convert a user goal into a JSON execution plan.

AVAILABLE AGENTS:
- system: reports CPU/RAM/disk/uptime metrics
- voice: speaks text aloud (text-to-speech)
- computer: opens Windows apps, types text, controls UI
- browser: web search using DuckDuckGo/Tavily
- file: organizes Downloads folder, sorts files
- vision: activates camera / gesture recognition

RESPONSE RULES:
1. Respond with ONLY a JSON object. No markdown. No commentary. No code fences.
2. Use MINIMUM steps. 1 step if possible, up to 5 steps maximum.
3. If the goal has a REPORT/SPEAK requirement, add a final voice step.
4. Each step MUST have: step (number), agent (string), command (string), description (string).

EXAMPLES:

Goal: "Check system status and speak the result"
{"steps":[{"step":1,"agent":"system","command":"system status","description":"Get system metrics"},{"step":2,"agent":"voice","command":"speak system status is healthy","description":"Report results aloud"}]}

Goal: "Open Notepad"
{"steps":[{"step":1,"agent":"computer","command":"open notepad","description":"Launch Notepad"}]}

Goal: "Search Germany visa requirements and read them aloud"
{"steps":[{"step":1,"agent":"browser","command":"search Germany visa requirements","description":"Research online"},{"step":2,"agent":"voice","command":"speak Germany visa requirements are ready","description":"Report to user"}]}

NOW RESPOND WITH JSON ONLY FOR THIS GOAL:`;

function callOllama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      format: "json",
      options: {
        temperature: 0.1,
        num_predict: 400,
        stop: ["\n\n", "Goal:", "User:"]
      }
    });

    const req = http.request(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.response || "");
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error("Ollama timeout"));
    });
    req.write(body);
    req.end();
  });
}

function extractJson(text) {
  if (!text) return null;
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1)); } catch (_) {}
  }
  return null;
}

function buildPromptWithMemory(goal, memoryContext) {
  let contextBlock = "";
  if (memoryContext && (memoryContext.session.length > 0 || memoryContext.relevant.length > 0)) {
    contextBlock = "\n\nCONTEXT FROM MEMORY (use if relevant):\n";
    if (memoryContext.relevant.length > 0) {
      contextBlock += "Relevant facts/projects:\n";
      for (const r of memoryContext.relevant.slice(0, 3)) {
        contextBlock += `- ${r.content || JSON.stringify(r)}\n`;
      }
    }
    if (memoryContext.session.length > 0) {
      contextBlock += "Recent activity:\n";
      for (const s of memoryContext.session.slice(0, 3)) {
        contextBlock += `- ${s.user_input || JSON.stringify(s)}\n`;
      }
    }
  }
  return `${PLANNER_PROMPT}\n${goal}${contextBlock}\n`;
}

class JarvisPlanner {
  constructor(options = {}) {
    this.registry = options.registry || null;
    this.memory = options.memory || null;
  }

  async createPlan(goal) {
    if (typeof goal !== "string" || !goal.trim()) {
      throw new Error("Goal must be a non-empty string.");
    }

    const cleanGoal = goal.trim();
    let rawResponse = "";
    let parsed = null;
    let usedFallback = false;
    let memoryContext = null;

    // Load memory context if available
    if (this.memory && typeof this.memory.getContextForGoal === "function") {
      try {
        memoryContext = this.memory.getContextForGoal(cleanGoal);
      } catch (_) {}
    }

    const fullPrompt = buildPromptWithMemory(cleanGoal, memoryContext);

    try {
      rawResponse = await callOllama(fullPrompt);
      parsed = extractJson(rawResponse);
    } catch (e) {
      rawResponse = `LLM_ERROR: ${e.message}`;
    }

    let plan;
    if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
      plan = parsed;
    } else {
      usedFallback = true;
      const g = cleanGoal.toLowerCase();
      const fallbackSteps = [];
      if (g.includes("system") || g.includes("cpu") || g.includes("ram") || g.includes("memory")) {
        fallbackSteps.push({ step: 1, agent: "system", command: "system status", description: "Get system metrics" });
      }
      if (g.includes("search") || g.includes("look up") || g.includes("research")) {
        fallbackSteps.push({ step: fallbackSteps.length + 1, agent: "browser", command: cleanGoal, description: "Web research" });
      }
      if (g.includes("organize") || g.includes("clean download") || g.includes("visa doc")) {
        fallbackSteps.push({ step: fallbackSteps.length + 1, agent: "file", command: cleanGoal, description: "File organization" });
      }
      if (g.includes("speak") || g.includes("say") || g.includes("tell me") || g.includes("read aloud") || g.includes("report")) {
        fallbackSteps.push({ step: fallbackSteps.length + 1, agent: "voice", command: `speak ${cleanGoal}`, description: "Speak result" });
      }
      if (fallbackSteps.length === 0) {
        fallbackSteps.push({ step: 1, agent: "computer", command: cleanGoal, description: "Execute command" });
      }
      plan = { steps: fallbackSteps };
    }

    const validAgents = ["computer", "browser", "file", "system", "voice", "vision"];
    plan.steps = plan.steps
      .filter(s => s && s.agent && validAgents.includes(s.agent) && s.command)
      .map((s, i) => ({
        step: i + 1,
        agent: s.agent,
        command: String(s.command),
        description: s.description || `Step ${i + 1}`,
        status: "PENDING",
        result: null,
        started_at: null,
        completed_at: null
      }));

    if (plan.steps.length === 0) {
      plan.steps = [{
        step: 1, agent: "computer", command: cleanGoal, description: "Default fallback",
        status: "PENDING", result: null, started_at: null, completed_at: null
      }];
      usedFallback = true;
    }

    return {
      plan_id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
      goal: cleanGoal,
      created_at: new Date().toISOString(),
      status: "READY",
      total_steps: plan.steps.length,
      steps: plan.steps,
      raw_llm_output: rawResponse,
      used_fallback: usedFallback,
      memory_context_used: memoryContext ? (memoryContext.session.length + memoryContext.relevant.length) : 0
    };
  }
}

function createJarvisPlanner(options) {
  return new JarvisPlanner(options);
}

module.exports = { JarvisPlanner, createJarvisPlanner };
