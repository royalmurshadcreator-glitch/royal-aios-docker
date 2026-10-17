
const origExit = process.exit;
process.exit = function(code) {
  console.trace('[EXIT DETECTED] code:', code);
  origExit(code);
};
/**
 * ROYAL JARVIS AUTODETECTOR AGENT (Agent #28)
 * Bridges the Python engine, provides live discovery API for the Control Panel.
 */
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const PY_ENGINE = path.join(ROOT, 'Agents', 'Specialized', 'AutoDetectorEngine.py');
const NAV_JSON = path.join(ROOT, 'App', 'data', 'memory', 'navigation.json');

function runDetection() {
    return new Promise((resolve, reject) => {
        const proc = spawn('D:\\01_ROYAL_JARVIS\\.venv\\Scripts\\python.exe', [PY_ENGINE], { cwd: ROOT });
        let output = '';
        proc.stdout.on('data', d => output += d.toString());
        proc.stderr.on('data', d => output += d.toString());
        proc.on('exit', code => {
            try { resolve(JSON.parse(output)); }
            catch(e) { resolve({ status: "error", raw: output }); }
        });
    });
}

function getNavigationMap() {
    if (fs.existsSync(NAV_JSON)) {
        try { return JSON.parse(fs.readFileSync(NAV_JSON, 'utf8')); }
        catch(e) { return null; }
    }
    return null;
}

module.exports = {
    id: 'autodetector',
    name: 'Auto-Detector Agent',
    version: '1.0.0',
    capabilities: ['scan_project', 'discover_agents', 'auto_navigation', 'update_ui'],
    
    runDetection,
    getNavigationMap,
    
    execute: async (command) => {
        if (command === 'scan' || command === 'detect') {
            return await runDetection();
        }
        if (command === 'navigation' || command === 'nav') {
            return getNavigationMap();
        }
        return { status: 'ready', agent: 'autodetector' };
    }
};

