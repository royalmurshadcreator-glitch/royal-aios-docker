const fs = require("fs");
const path = require("path");

const WS_FILE = path.resolve(__dirname, "..", "..", "App", "data", "memory", "workspaces.jsonl");

function ensureStorage() {
  const dir = path.dirname(WS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(WS_FILE)) fs.writeFileSync(WS_FILE, "", "utf-8");
}

function loadWorkspaces() {
  ensureStorage();
  try {
    const lines = fs.readFileSync(WS_FILE, "utf-8").split("\n").filter(l => l.trim());
    const list = lines.map(l => JSON.parse(l));
    if (list.length === 0) {
      const defaultWs = {
        id: "ws_main",
        name: "Main Workspace",
        created_at: new Date().toISOString(),
        active_plan_id: null,
        history: []
      };
      fs.writeFileSync(WS_FILE, JSON.stringify(defaultWs) + "\n", "utf-8");
      return [defaultWs];
    }
    return list;
  } catch (_) {
    return [{ id: "ws_main", name: "Main Workspace", created_at: new Date().toISOString(), active_plan_id: null, history: [] }];
  }
}

function saveWorkspaces(list) {
  ensureStorage();
  const content = list.map(w => JSON.stringify(w)).join("\n") + (list.length ? "\n" : "");
  fs.writeFileSync(WS_FILE, content, "utf-8");
}

class WorkspaceAgent {
  constructor(options = {}) {
    this.id = "workspace";
    this.name = "JARVIS Parallel Workspaces Agent";
    this.riskLevel = "LEVEL_0";
    this.capabilities = [
      "parallel_workspaces",
      "workspace_isolation",
      "multi_thread_planning",
      "session_tab_management",
      "concurrent_execution"
    ];
    this.orchestrator = options.orchestrator || null;
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["workspace", "new tab", "create tab", "parallel thread", "switch workspace", "list tabs"];
    return keywords.some(k => c.includes(k)) ? 95 : 0;
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.riskLevel,
      capabilities: this.capabilities,
      total_workspaces: loadWorkspaces().length
    };
  }

  listWorkspaces() {
    return loadWorkspaces();
  }

  createWorkspace(name = "New Workspace") {
    const list = loadWorkspaces();
    const ws = {
      id: "ws_" + Date.now().toString(36).slice(-6),
      name: name.trim() || ("Workspace " + (list.length + 1)),
      created_at: new Date().toISOString(),
      active_plan_id: null,
      history: []
    };
    list.push(ws);
    saveWorkspaces(list);
    return { success: true, workspace: ws, total: list.length };
  }

  deleteWorkspace(id) {
    if (id === "ws_main") {
      return { success: false, error: "Cannot delete default Main Workspace" };
    }
    const list = loadWorkspaces();
    const filtered = list.filter(w => w.id !== id);
    saveWorkspaces(filtered);
    return { success: true, deleted_id: id, remaining: filtered.length };
  }

  updateWorkspacePlan(id, planId) {
    const list = loadWorkspaces();
    const target = list.find(w => w.id === id);
    if (target) {
      target.active_plan_id = planId;
      if (planId && !target.history.includes(planId)) {
        target.history.push(planId);
      }
      saveWorkspaces(list);
    }
    return target;
  }

  async execute(analysis) {
    const cmd = analysis.raw_command || analysis.command || "";
    if (cmd.toLowerCase().includes("create") || cmd.toLowerCase().includes("new")) {
      return this.createWorkspace(cmd.replace(/(create|new|workspace|tab)/gi, "").trim());
    }
    return { success: true, agent: this.id, workspaces: this.listWorkspaces() };
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "workspace_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

function createWorkspaceAgent(options) {
  return new WorkspaceAgent(options);
}

module.exports = { WorkspaceAgent, createWorkspaceAgent };
