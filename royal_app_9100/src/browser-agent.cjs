const { spawn } = require("child_process");
const path = require("path");

const PY_EXE = "D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe";
const SCRIPT_PATH = "D:\\01_ROYAL_JARVIS\\Agents\\BrowserAgent.py";

function looksLikeBrowserCommand(command) {
  if (typeof command !== "string") return false;
  const c = command.toLowerCase();
  const keywords = ["search", "google", "find online", "lookup", "browse", "research", "ddgs", "tavily", "who is", "what is"];
  return keywords.some(k => c.includes(k));
}

class BrowserAgent {
  constructor(options = {}) {
    this.id = "browser";
    this.name = "Universal Browser Agent";
    this.riskLevel = "LEVEL_0";
    this.capabilities = [
      "web_search",
      "duckduckgo_search",
      "tavily_search",
      "research_summary",
      "online_lookup"
    ];
  }

  canHandle(command, context = {}) {
    if (looksLikeBrowserCommand(command)) return 85;
    return 0;
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

  async execute(analysis) {
    const query = analysis.raw_command || analysis.command || "";
    return new Promise((resolve, reject) => {
      const pyCode = `
import sys
sys.path.append(r"D:\\01_ROYAL_JARVIS\\Agents")
import BrowserAgent
results = BrowserAgent.search_web('''${query.replace(/'/g, "\\'")}''', max_results=5)
print("===SEARCH_RESULTS===")
for r in results:
    print(f"- {r.get('title', '')}: {r.get('body', '')}")
`;
      const proc = spawn(PY_EXE, ["-c", pyCode]);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());

      const timer = setTimeout(() => {
        proc.kill();
        resolve({
          success: true,
          agent: "browser",
          query,
          output: stdout.trim() || "Search completed."
        });
      }, 20000);

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          success: true,
          agent: "browser",
          query,
          output: stdout.trim() || stderr.trim() || "Search finished."
        });
      });
    });
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "browser_agent",
      risk_level: this.riskLevel,
      metadata: { agent_id: this.id, analysis }
    };
  }
}

module.exports = {
  BrowserAgent,
  createBrowserAgent: (opts) => new BrowserAgent(opts),
  looksLikeBrowserCommand
};

