const { spawn } = require("child_process");
const path = require("path");

const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const SCRIPT_PATH = "D:\\01_ROYAL_JARVIS\\Agents\\Specialized\\EcommerceAgent.py";

class EcommerceAgent {
  constructor(options = {}) {
    this.id = "ecommerce";
    this.name = "JARVIS 24/7 Autonomous E-Commerce Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = [
      "product_research",
      "seo_listing_generator",
      "order_fulfillment_tracker",
      "auto_customer_reply",
      "ecom_profit_digest"
    ];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["ecommerce", "e-commerce", "store", "product listing", "sales report", "orders", "revenue", "money maker"];
    return keywords.some(k => c.includes(k)) ? 90 : 0;
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.riskLevel,
      capabilities: this.capabilities
    };
  }

  getSummary() {
    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [SCRIPT_PATH, "summary"]);
      let stdout = "";
      proc.stdout.on("data", d => stdout += d.toString());
      const timer = setTimeout(() => { proc.kill(); resolve({ status: "FAILED", error: "E-Commerce summary timeout" }); }, 10000);
      proc.on("close", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(stdout.trim())); }
        catch (_) { resolve({ status: "FAILED", error: "Invalid store response" }); }
      });
    });
  }

  generateListing(keyword) {
    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [SCRIPT_PATH, "generate", keyword]);
      let stdout = "";
      proc.stdout.on("data", d => stdout += d.toString());
      const timer = setTimeout(() => { proc.kill(); resolve({ status: "FAILED", error: "Generator timeout" }); }, 15000);
      proc.on("close", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(stdout.trim())); }
        catch (_) { resolve({ status: "FAILED", error: "Generator parse failed" }); }
      });
    });
  }

  async execute(analysis) {
    const cmd = (analysis.raw_command || analysis.command || "").toLowerCase();
    if (cmd.includes("generate") || cmd.includes("listing") || cmd.includes("product")) {
      const kw = cmd.replace(/(generate|listing|product|ecommerce|e-commerce|store)/gi, "").trim() || "Visa Package";
      const genRes = await this.generateListing(kw);
      return { success: true, agent: this.id, result: genRes };
    }

    const summary = await this.getSummary();
    return {
      success: true,
      agent: this.id,
      command: cmd,
      summary,
      message: `E-Commerce Store Digest: PKR ${summary.total_revenue_pkr || 0} total revenue across ${summary.active_listings || 0} active listing(s).`
    };
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "ecommerce_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

function createEcommerceAgent(options) {
  return new EcommerceAgent(options);
}

module.exports = { EcommerceAgent, createEcommerceAgent };

