/**
 * ROYAL JARVIS — Emotion Agent
 *
 * Reads feeling state and can trigger emotion events.
 * Bridges Python feeling_engine → Node orchestrator.
 *
 * Built following voice-agent.cjs pattern.
 */

const http = require("http");

const API_HOST = "127.0.0.1";
const API_PORT = 9000;

function callApi(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: API_HOST,
      port: API_PORT,
      path,
      method,
      headers: data ? {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data)
      } : {}
    };
    const req = http.request(opts, (res) => {
      let buf = "";
      res.on("data", (chunk) => (buf += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); }
        catch (_) { resolve({ raw: buf, http_status: res.statusCode }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const EMOTION_KEYWORDS = [
  "emotion", "feeling", "mood", "state of mind", "how do you feel",
  "how are you feeling", "sentiment", "trigger feeling", "reset feeling",
  "show feelings", "current emotions", "affect"
];

function looksLikeEmotionCommand(command) {
  if (typeof command !== "string") return false;
  const c = command.toLowerCase();
  return EMOTION_KEYWORDS.some(k => c.includes(k));
}

class EmotionAgent {
  constructor(options = {}) {
    this.id = "emotion";
    this.name = "Emotion State Agent";
    this.risk_level = "LEVEL_1";
    this.priority = 80;
    this.enabled = true;
    this.capabilities = [
      "read_feeling_state",
      "trigger_feeling_event",
      "reset_feelings",
      "fusion_state",
      "sentiment_read",
      "behavior_read"
    ];
  }

  canHandle(command, context = {}) {
    if (looksLikeEmotionCommand(command)) return 85;
    return 0;
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      online: true,
      risk_level: this.risk_level,
      capabilities: this.capabilities
    };
  }

  async execute(analysis) {
    const raw = (analysis && (analysis.raw_command || analysis.command)) || "";
    const lower = raw.toLowerCase();

    try {
      // reset
      if (/\breset\b/.test(lower)) {
        const r = await callApi("/api/feeling/reset", "POST", {});
        return {
          success: true,
          agent: "emotion",
          action: "reset",
          result: r,
          message: "Feeling state reset to baseline."
        };
      }

      // trigger <event>
      const triggerMatch = lower.match(/trigger\s+([a-z_]+)/);
      if (triggerMatch) {
        const eventName = triggerMatch[1];
        const r = await callApi("/api/feeling/trigger", "POST", { event: eventName });
        return {
          success: !!(r && r.ok),
          agent: "emotion",
          action: "trigger",
          event: eventName,
          result: r,
          message: r && r.ok
            ? `Triggered emotion event: ${eventName}`
            : `Trigger failed: ${(r && r.reason) || "unknown"}`
        };
      }

      // default: full state read (feeling + fusion + behavior + sentiment)
      const [feeling, fusion, behavior, sentiment] = await Promise.all([
        callApi("/api/feeling/state").catch(() => ({})),
        callApi("/api/fusion/live").catch(() => ({})),
        callApi("/api/behavior/current").catch(() => ({})),
        callApi("/api/text-sentiment/current").catch(() => ({}))
      ]);

      const states = (feeling && feeling.states) || {};
      const topState = Object.entries(states)
        .sort((a, b) => b[1] - a[1])[0] || ["neutral", 0];

      return {
        success: true,
        agent: "emotion",
        action: "read",
        dominant: { state: topState[0], value: topState[1] },
        feeling_states: states,
        fusion: fusion || {},
        behavior: behavior || {},
        sentiment: sentiment || {},
        message: `Emotion state read. Dominant: ${topState[0]} (${topState[1]}).`
      };
    } catch (err) {
      return {
        success: false,
        agent: "emotion",
        error: String((err && err.message) || err).slice(0, 200)
      };
    }
  }

  async createTask(analysis) {
    return {
      command: analysis.raw_command || analysis.command,
      source: "emotion_agent",
      risk_level: this.risk_level,
      metadata: { agent_id: this.id, analysis }
    };
  }
}

module.exports = {
  EmotionAgent,
  createEmotionAgent: (opts) => new EmotionAgent(opts),
  looksLikeEmotionCommand
};