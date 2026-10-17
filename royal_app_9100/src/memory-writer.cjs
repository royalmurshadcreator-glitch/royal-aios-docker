'use strict';

/**
 * Bridge from the Node orchestrator to the Python Memory Palace.
 * Fire-and-forget: failures are logged and do not throw into the task runner.
 * JSON payloads are sent through stdin, never embedded in generated Python.
 */

const { spawn } = require('child_process');
const path = require('path');

const PYTHON = process.env.ROYAL_MURSHAD_PYTHON ||
  path.resolve(__dirname, '..', '..', '..', '..', '18_ENV', '.venv', 'Scripts', 'python.exe');
const MEM_DIR = process.env.ROYAL_MURSHAD_MEMORY_DIR ||
  path.resolve(__dirname, '..', '..', '..', '..', '04_MEMORY', 'aios_memory');

function safeStr(v, max = 500) {
  if (v === null || v === undefined) return null;
  let s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return (s === undefined ? String(v) : s).slice(0, max);
}

function writeEpisode(episode) {
  // Test isolation: prevent writes to the production Memory Palace.
  if (process.env.ROYAL_MURSHAD_MEMORY_DISABLED === '1') return;
  if (!episode || typeof episode !== 'object') {
    console.error('[memory-writer] invalid episode payload');
    return;
  }

  const payload = {
    agent: episode.agent || 'unknown',
    command: safeStr(episode.command, 500) || '',
    task_id: episode.taskId || null,
    success: !!episode.success,
    result: safeStr(episode.result, 2000),
    error: safeStr(episode.error, 500),
    source: episode.source || null,
    extra: episode.extra || {},
  };

  const pyCode = [
    'import json, os, sys',
    'sys.path.insert(0, os.environ["ROYAL_MURSHAD_MEMORY_DIR"])',
    'from aios_memory_palace import PALACE',
    'payload = json.loads(sys.stdin.read())',
    'saved = PALACE.save_episode(',
    '    agent=payload["agent"],',
    '    command=payload["command"],',
    '    task_id=payload["task_id"],',
    '    success=payload["success"],',
    '    result=payload["result"],',
    '    error=payload["error"],',
    '    source=payload["source"],',
    '    extra=payload["extra"],',
    ')',
    'print(json.dumps(saved, ensure_ascii=False))',
  ].join('\n');

  let child;
  try {
    child = spawn(PYTHON, ['-c', pyCode], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ROYAL_MURSHAD_MEMORY_DIR: MEM_DIR },
      windowsHide: true,
    });
  } catch (e) {
    console.error('[memory-writer] spawn failed', e.message);
    return;
  }

  let out = '';
  let err = '';
  child.stdout.on('data', (d) => {
    if (out.length < 4000) out += d.toString().slice(0, 4000 - out.length);
  });
  child.stderr.on('data', (d) => {
    if (err.length < 4000) err += d.toString().slice(0, 4000 - err.length);
  });
  child.on('error', (e) => {
    console.error('[memory-writer] spawn failed', e.message);
  });
  child.on('close', (code) => {
    if (code !== 0) {
      console.error('[memory-writer] python exited', code, err.slice(0, 2000));
    }
  });

  child.stdin.on('error', (e) => {
    if (e.code !== 'EPIPE') {
      console.error('[memory-writer] stdin failed', e.message);
    }
  });
  child.stdin.end(JSON.stringify(payload));
}

module.exports = { writeEpisode };
