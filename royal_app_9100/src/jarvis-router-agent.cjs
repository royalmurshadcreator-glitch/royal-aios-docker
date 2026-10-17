const http = require("http");
const fs = require("fs");
const path = require("path");

const OLLAMA_TAGS_URL = "http://127.0.0.1:11434/api/tags";

class RouterAgent {
  constructor(options = {}) {
    this.id = "router";
    this.name = "JARVIS Multi-Model Router Agent";
    this.riskLevel = "LEVEL_0";
    this.capabilities = [
      "multi_model_routing",
      "model_discovery",
      "complexity_scoring",
      "cloud_fallback_management",
      "dynamic_llm_dispatch"
    ];
    this.orchestrator = options.orchestrator || null;
    this.defaultModel = "qwen2.5:3b";
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["router", "select model", "switch model", "list models", "route model", "model status"];
    return keywords.some(k => c.includes(k)) ? 95 : 0;
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.riskLevel,
      capabilities: this.capabilities,
      default_model: this.defaultModel
    };
  }

  listLocalModels() {
    return new Promise((resolve) => {
      const req = http.get(OLLAMA_TAGS_URL, { timeout: 3000 }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const models = (parsed.models || []).map(m => m.name);
            resolve(models.length ? models : [this.defaultModel]);
          } catch (_) {
            resolve([this.defaultModel]);
          }
        });
      });
      req.on("error", () => resolve([this.defaultModel]));
      req.on("timeout", () => { req.destroy(); resolve([this.defaultModel]); });
    });
  }

  scoreComplexity(prompt = "") {
    const p = String(prompt || "").toLowerCase();
    let score = 20;

    if (p.length > 200) score += 20;
    if (p.length > 500) score += 20;

    const complexKeywords = [
      "python", "code", "refactor", "debug", "algorithm", "architecture",
      "multi-step", "decompose", "analyze data", "chart", "deep reasoning",
      "equation", "financial report", "visa strategy", "critique"
    ];

    complexKeywords.forEach(kw => {
      if (p.includes(kw)) score += 15;
    });

    return Math.min(100, score);
  }

  async routeTask(prompt = "", context = {}) {
    const promptStr = String(prompt || "");
    const localModels = await this.listLocalModels();
    const score = this.scoreComplexity(promptStr);

    let selectedModel = this.defaultModel;
    let provider = "ollama_local";
    let tier = "FAST_LOCAL";

    if (score >= 70) {
      const heavyModel = localModels.find(m => m.includes("7b") || m.includes("8b") || m.includes("deepseek") || m.includes("llama3"));
      if (heavyModel) {
        selectedModel = heavyModel;
        tier = "HEAVY_LOCAL";
      } else {
        selectedModel = localModels[0] || this.defaultModel;
        tier = "FAST_LOCAL_FALLBACK";
      }
    } else if (score >= 40) {
      const medModel = localModels.find(m => m.includes("qwen") || m.includes("mistral") || m.includes("3b"));
      selectedModel = medModel || localModels[0] || this.defaultModel;
      tier = "BALANCED_LOCAL";
    } else {
      selectedModel = localModels.find(m => m.includes("3b") || m.includes("mini")) || localModels[0] || this.defaultModel;
      tier = "FAST_LOCAL";
    }

    return {
      success: true,
      prompt: promptStr,
      complexity_score: score,
      selected_model: selectedModel,
      provider,
      tier,
      available_local_models: localModels
    };
  }

  async execute(analysis) {
    const cmd = analysis.raw_command || analysis.command || "";
    return await this.routeTask(cmd, analysis.context || {});
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "router_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

function createRouterAgent(options) {
  return new RouterAgent(options);
}

module.exports = { RouterAgent, createRouterAgent };
