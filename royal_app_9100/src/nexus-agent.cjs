/**
 * ROYAL JARVIS NEXUS AGENT (Agent #30)
 * Auto-connects all systems and exposes boot sequence + runtime pipeline.
 */
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');
const PY_ENGINE = path.join(ROOT, 'Agents', 'Specialized', 'NexusEngine.py');
const GRAPH_JSON = path.join(ROOT, 'App', 'data', 'memory', 'nexus_graph.json');

function runConnect() {
  return new Promise((resolve) => {
    const proc = spawn('D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe', [PY_ENGINE], { cwd: ROOT });
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (out += d.toString()));
    proc.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        resolve({ ok: false, status: 'ERROR', message: 'Nexus parse failed', raw: out.slice(0, 2000) });
      }
    });
  });
}

function getGraph() {
  if (fs.existsSync(GRAPH_JSON)) {
    try {
      return JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function probe(urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port: 3000, path: urlPath, timeout: 2500 }, (res) => {
      resolve({ path: urlPath, ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode });
      res.resume();
    });
    req.on('error', () => resolve({ path: urlPath, ok: false, status: 0 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ path: urlPath, ok: false, status: 0 });
    });
  });
}

async function verifySequence() {
  const graph = getGraph() || (await runConnect() && getGraph());
  if (!graph) return { ok: false, status: 'NO_GRAPH', steps: [] };

  const checks = [
    { step: 1, name: 'HUD Server', path: '/api/status' },
    { step: 2, name: 'Agents API', path: '/api/jarvis' },
    { step: 3, name: 'Bank Vault', path: '/api/jarvis/bank' },
    { step: 4, name: 'E-Commerce', path: '/api/jarvis/ecommerce' },
    { step: 5, name: 'Auto-Detector Nav', path: '/api/jarvis/navigation' },
    { step: 6, name: 'Sentinel', path: '/api/jarvis/sentinel/last' },
  ];

  const results = [];
  for (const c of checks) {
    const r = await probe(c.path);
    results.push({
      step: c.step,
      name: c.name,
      path: c.path,
      ok: r.ok,
      status: r.status,
      state: r.ok ? 'CONNECTED' : 'DOWN',
    });
  }

  const passed = results.filter((x) => x.ok).length;
  return {
    ok: passed === results.length,
    status: passed === results.length ? 'SEQUENCE_OK' : 'SEQUENCE_PARTIAL',
    passed,
    total: results.length,
    steps: results,
    boot_sequence: graph.boot_sequence || [],
    runtime_pipeline: graph.runtime_pipeline || [],
    summary: graph.summary || {},
  };
}

module.exports = {
  id: 'nexus',
  name: 'Nexus Auto-Connect Agent',
  version: '1.0.0',
  capabilities: ['auto_connect', 'sequence', 'pipeline', 'graph', 'verify'],
  runConnect,
  getGraph,
  verifySequence,
  execute: async (command) => {
    const cmd = (command || '').toLowerCase();
    if (cmd === 'connect' || cmd === 'build' || cmd === 'scan') return runConnect();
    if (cmd === 'graph' || cmd === 'status') return getGraph();
    if (cmd === 'sequence' || cmd === 'verify' || cmd === 'boot') return verifySequence();
    if (cmd === 'pipeline') {
      const g = getGraph();
      return g ? { ok: true, runtime_pipeline: g.runtime_pipeline, boot_sequence: g.boot_sequence } : { ok: false };
    }
    return { status: 'ready', agent: 'nexus' };
  },
};

if (require.main === module) {
    const http = require('http');
    const PORT = 3001;
    http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ONLINE', service: 'Nexus Engine', port: PORT }));
    }).listen(PORT, () => console.log(`[ONLINE] Nexus Engine listening on port ${PORT}`));
}
