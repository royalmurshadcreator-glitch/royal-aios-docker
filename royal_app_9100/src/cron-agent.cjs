const fs = require("fs");
const path = require("path");

const CRON_FILE = path.resolve(__dirname, "..", "..", "App", "data", "memory", "cron-jobs.jsonl");

function ensureStorage() {
  const dir = path.dirname(CRON_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CRON_FILE)) fs.writeFileSync(CRON_FILE, "", "utf-8");
}

function loadJobs() {
  ensureStorage();
  try {
    const lines = fs.readFileSync(CRON_FILE, "utf-8").split("\n").filter(l => l.trim());
    return lines.map(l => JSON.parse(l));
  } catch (_) {
    return [];
  }
}

function saveJobs(list) {
  ensureStorage();
  const content = list.map(j => JSON.stringify(j)).join("\n") + (list.length ? "\n" : "");
  fs.writeFileSync(CRON_FILE, content, "utf-8");
}

class CronAgent {
  constructor(options = {}) {
    this.id = "cron";
    this.name = "JARVIS Autonomous Cron Scheduler Agent";
    this.riskLevel = "LEVEL_1";
    this.capabilities = [
      "autonomous_cron_scheduler",
      "recurring_task_execution",
      "background_job_management",
      "proactive_automation",
      "timer_dispatch"
    ];
    this.orchestrator = options.orchestrator || null;
    this.brain = options.brain || null;
    this.timer = null;
    
    // Auto-start background scheduler loop
    this.startScheduler();
  }

  canHandle(command) {
    if (typeof command !== "string") return 0;
    const c = command.toLowerCase();
    const keywords = ["cron", "schedule job", "add cron", "list jobs", "recurring task", "timer job"];
    return keywords.some(k => c.includes(k)) ? 95 : 0;
  }

  status() {
    const jobs = loadJobs();
    return {
      id: this.id,
      name: this.name,
      online: true,
      scheduler_active: this.timer !== null,
      risk_level: this.riskLevel,
      capabilities: this.capabilities,
      total_jobs: jobs.length,
      enabled_jobs: jobs.filter(j => j.enabled).length
    };
  }

  listJobs() {
    return loadJobs();
  }

  addJob(jobData) {
    const jobs = loadJobs();
    const name = jobData.name || "Cron Job " + (jobs.length + 1);
    const command = jobData.command || "system status";
    const schedule = jobData.schedule || "interval 60"; // e.g. "interval 60" (seconds) or "daily 09:00"

    const newJob = {
      id: "cron_" + Date.now().toString(36).slice(-6),
      name: name.trim(),
      command: command.trim(),
      schedule: schedule.trim(),
      enabled: jobData.enabled !== false,
      created_at: new Date().toISOString(),
      last_run: null,
      run_count: 0
    };

    jobs.push(newJob);
    saveJobs(jobs);
    return { success: true, job: newJob, total: jobs.length };
  }

  removeJob(id) {
    const jobs = loadJobs();
    const filtered = jobs.filter(j => j.id !== id);
    saveJobs(filtered);
    return { success: true, removed_id: id, remaining: filtered.length };
  }

  toggleJob(id, enabled) {
    const jobs = loadJobs();
    const target = jobs.find(j => j.id === id);
    if (target) {
      target.enabled = enabled === true;
      saveJobs(jobs);
    }
    return target;
  }

  shouldRun(job) {
    if (!job.enabled) return false;
    const now = Date.now();
    const lastRun = job.last_run ? new Date(job.last_run).getTime() : 0;

    // Interval format: "interval 30" (run every 30 seconds)
    if (job.schedule.startsWith("interval ")) {
      const seconds = parseInt(job.schedule.replace("interval ", "")) || 60;
      return (now - lastRun) >= (seconds * 1000);
    }

    // Every format: "every 1h" or "every 30m"
    if (job.schedule.startsWith("every ")) {
      const unit = job.schedule.slice(-1);
      const val = parseInt(job.schedule.replace("every ", "").slice(0, -1)) || 1;
      let ms = val * 60 * 1000; // default minutes
      if (unit === "h") ms = val * 60 * 60 * 1000;
      if (unit === "s") ms = val * 1000;
      return (now - lastRun) >= ms;
    }

    // Daily format: "daily 09:00"
    if (job.schedule.startsWith("daily ")) {
      const targetTime = job.schedule.replace("daily ", "").trim();
      const currentHM = new Date().toTimeString().slice(0, 5);
      if (currentHM === targetTime) {
        // Run only once per minute window
        return (now - lastRun) >= 65000;
      }
    }

    return false;
  }

  async checkAndExecuteJobs() {
    const jobs = loadJobs();
    let updated = false;

    for (const job of jobs) {
      if (this.shouldRun(job)) {
        console.log(`[CRON-SCHEDULER] Triggering autonomous job: "${job.name}" -> Command: "${job.command}"`);
        job.last_run = new Date().toISOString();
        job.run_count = (job.run_count || 0) + 1;
        updated = true;

        if (this.brain && typeof this.brain.dispatch === "function") {
          try {
            await this.brain.dispatch(job.command, { source: "cron_scheduler", job_id: job.id });
          } catch (err) {
            console.error(`[CRON-EXEC-ERR] Job ${job.id} failed:`, err.message);
          }
        }
      }
    }

    if (updated) {
      saveJobs(jobs);
    }
  }

  startScheduler() {
    if (this.timer) clearInterval(this.timer);
    // Check every 10 seconds for interval/daily triggers
    this.timer = setInterval(() => {
      this.checkAndExecuteJobs().catch(e => console.error("[CRON-CHECK-ERR]", e));
    }, 10000);
    if (this.timer && typeof this.timer.unref === "function") { this.timer.unref(); }
    console.log("[CRON-SCHEDULER] Autonomous background scheduler loop active.");
  }

  async execute(analysis) {
    const cmd = analysis.raw_command || analysis.command || "";
    if (cmd.toLowerCase().includes("add") || cmd.toLowerCase().includes("schedule")) {
      return this.addJob({ name: "User Scheduled Job", command: cmd, schedule: "interval 300" });
    }
    return { success: true, agent: this.id, jobs: this.listJobs() };
  }

  async createTask(analysis) {
    return { command: analysis.command, source: "cron_agent", risk_level: this.riskLevel, metadata: { agent_id: this.id } };
  }
}

function createCronAgent(options) {
  return new CronAgent(options);
}

module.exports = { CronAgent, createCronAgent };

