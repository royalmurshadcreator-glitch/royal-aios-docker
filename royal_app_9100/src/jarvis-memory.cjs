const fs = require("fs");
const path = require("path");

const MEMORY_ROOT = path.resolve(__dirname, "..", "..", "App", "data", "memory");

const LAYERS = {
  session: {
    file: "session.jsonl",
    maxEntries: 20,
    description: "Rolling last 20 conversations"
  },
  project: {
    file: "projects.jsonl",
    maxEntries: 500,
    description: "Active projects (Germany visa, business, etc.)"
  },
  longterm: {
    file: "long-term.jsonl",
    maxEntries: 1000,
    description: "Preferences, permanent facts"
  },
  execution: {
    file: "execution.jsonl",
    maxEntries: 1000,
    description: "Success/failure history"
  }
};

function ensureDir() {
  if (!fs.existsSync(MEMORY_ROOT)) {
    fs.mkdirSync(MEMORY_ROOT, { recursive: true });
  }
}

function readAll(layer) {
  ensureDir();
  const cfg = LAYERS[layer];
  if (!cfg) return [];
  const filePath = path.join(MEMORY_ROOT, cfg.file);
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim());
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch (_) {}
  }
  return entries;
}

function writeAll(layer, entries) {
  ensureDir();
  const cfg = LAYERS[layer];
  if (!cfg) throw new Error(`Unknown layer: ${layer}`);
  const filePath = path.join(MEMORY_ROOT, cfg.file);
  const tmpPath = filePath + ".tmp";

  // Trim to max entries (keep newest)
  const trimmed = entries.slice(-cfg.maxEntries);
  const content = trimmed.map(e => JSON.stringify(e)).join("\n") + (trimmed.length ? "\n" : "");
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

class JarvisMemory {
  constructor() {
    ensureDir();
  }

  add(layer, entry) {
    if (!LAYERS[layer]) throw new Error(`Invalid memory layer: ${layer}`);
    if (typeof entry !== "object" || entry === null) throw new Error("Entry must be an object");

    const record = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      created_at: new Date().toISOString(),
      layer,
      ...entry
    };

    const all = readAll(layer);
    all.push(record);
    writeAll(layer, all);
    return record;
  }

  get(layer, id) {
    return readAll(layer).find(e => e.id === id) || null;
  }

  list(layer, limit = 50) {
    return readAll(layer).slice(-limit).reverse();
  }

  remove(layer, id) {
    const all = readAll(layer);
    const idx = all.findIndex(e => e.id === id);
    if (idx === -1) return false;
    all.splice(idx, 1);
    writeAll(layer, all);
    return true;
  }

  search(query, layers = ["session", "project", "longterm", "execution"]) {
    if (typeof query !== "string" || !query.trim()) return [];
    const q = query.toLowerCase().trim();
    const results = [];

    for (const layer of layers) {
      const entries = readAll(layer);
      for (const e of entries) {
        const text = JSON.stringify(e).toLowerCase();
        if (text.includes(q)) {
          results.push({ layer, ...e });
        }
      }
    }
    return results.slice(0, 50);
  }

  getContextForGoal(goal) {
    // Auto-inject relevant memory into planner
    if (typeof goal !== "string" || !goal.trim()) return { session: [], relevant: [] };

    const session = readAll("session").slice(-5).reverse();
    const relevant = this.search(goal, ["project", "longterm"]).slice(0, 5);

    return { session, relevant };
  }

  logExecution(entry) {
    return this.add("execution", {
      type: "execution",
      goal: entry.goal || null,
      plan_id: entry.plan_id || null,
      status: entry.status || "UNKNOWN",
      steps_completed: entry.steps_completed || 0,
      steps_failed: entry.steps_failed || 0,
      duration_ms: entry.duration_ms || null,
      error: entry.error || null
    });
  }

  logSession(entry) {
    return this.add("session", {
      type: "session",
      user_input: entry.user_input || null,
      agent_used: entry.agent_used || null,
      result_summary: entry.result_summary || null
    });
  }

  stats() {
    const s = {};
    for (const layer of Object.keys(LAYERS)) {
      s[layer] = {
        count: readAll(layer).length,
        max: LAYERS[layer].maxEntries,
        description: LAYERS[layer].description
      };
    }
    return s;
  }
}

function createJarvisMemory() {
  return new JarvisMemory();
}

module.exports = { JarvisMemory, createJarvisMemory, LAYERS };
