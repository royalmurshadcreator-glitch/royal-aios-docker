const { spawn } = require("child_process");
const path = require("path");

const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const SCRIPT_PATH = "D:\\01_ROYAL_JARVIS\\Agents\\Specialized\\BankTrackerAgent.py";

class BankTrackerAgent {
  constructor(options = {}) {
    this.id = "bank_tracker";
    this.name = "JARVIS Encrypted Bank & Financial Tracker Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = [
      "bank_account_summary",
      "liquid_assets_tracker",
      "transaction_logging",
      "financial_balance_update",
      "encrypted_vault_manager"
    ];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["bank", "balance", "account number", "net worth", "financial summary", "money", "funds", "iban"];
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
      const timer = setTimeout(() => { proc.kill(); resolve({ status: "FAILED", error: "Bank query timeout" }); }, 10000);
      proc.on("close", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(stdout.trim())); }
        catch (_) { resolve({ status: "FAILED", error: "Invalid bank response" }); }
      });
    });
  }

  updateBalance(bankName, balance, currency = "PKR") {
    return new Promise((resolve) => {
      const proc = spawn(PY_EXE, [SCRIPT_PATH, "update", bankName, String(balance), currency]);
      let stdout = "";
      proc.stdout.on("data", d => stdout += d.toString());
      const timer = setTimeout(() => { proc.kill(); resolve({ status: "FAILED", error: "Update timeout" }); }, 10000);
      proc.on("close", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(stdout.trim())); }
        catch (_) { resolve({ status: "FAILED", error: "Update parse failed" }); }
      });
    });
  }

  async execute(analysis) {
    const cmd = (analysis.raw_command || analysis.command || "").toLowerCase();
    const summary = await this.getSummary();

    return {
      success: true,
      agent: this.id,
      command: cmd,
      summary,
      message: `Bank Vault Query: ${summary.total_accounts || 0} account(s) active.`
    };
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "bank_tracker_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

function createBankTrackerAgent(options) {
  return new BankTrackerAgent(options);
}

module.exports = { BankTrackerAgent, createBankTrackerAgent };

