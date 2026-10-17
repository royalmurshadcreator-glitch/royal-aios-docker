const http = require("http");
const { spawn, exec } = require("child_process");
const path = require("path");

const SERVICES = {
  dashboard: {
    url: "http://127.0.0.1:3000/api/status",
    restart: () => {
      console.log("[WATCHDOG] Restarting Dashboard server...");
      const p = spawn("node.exe", ["D:\\01_ROYAL_JARVIS\\App\\server.js"], {
        cwd: "D:\\01_ROYAL_JARVIS\\App",
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      p.unref();
    }
  },
  bridge: {
    url: "http://127.0.0.1:3031/health",
    restart: () => {
      console.log("[WATCHDOG] Restarting Master Bridge...");
      const p = spawn("node.exe", ["D:\\01_ROYAL_JARVIS\\Core\\bridge.cjs"], {
        cwd: "D:\\01_ROYAL_JARVIS\\Core",
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      p.unref();
    }
  },
  ollama: {
    url: "http://127.0.0.1:11434/api/tags",
    restart: () => {
      console.log("[WATCHDOG] Restarting Ollama service...");
      const p = spawn("ollama.exe", ["serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      p.unref();
    }
  }
};

function checkService(name, config) {
  return new Promise((resolve) => {
    const req = http.get(config.url, { timeout: 3000 }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function watchdogCycle() {
  for (const [name, config] of Object.entries(SERVICES)) {
    const isAlive = await checkService(name, config);
    if (!isAlive) {
      console.warn(`[WATCHDOG] Service DOWN: ${name}. Initiating recovery...`);
      config.restart();
    }
  }
}

console.log("[WATCHDOG] Royal Jarvis Self-Healing Watchdog ACTIVE.");
setInterval(watchdogCycle, 10000);
watchdogCycle();
