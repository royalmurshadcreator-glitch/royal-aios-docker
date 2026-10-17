'use strict';

/**
 * ROYAL JARVIS ORCHESTRATOR - risk-classifier.cjs
 *
 * Deterministic, local, keyword-based command risk classification.
 * No AI calls, no network - classification must be instant and auditable.
 *
 *   LEVEL_0  read-only / informational / conversation     (no confirmation)
 *   LEVEL_1  safe, reversible actions                     (no confirmation)
 *   LEVEL_2  system/file/app modifications                (confirmation required)
 *   LEVEL_3  high-risk or irreversible                    (confirmation required)
 *
 * Philosophy (Phase B upgrade):
 *   - Conversation and questions run freely (LEVEL_0)
 *   - Actions follow the keyword table
 *   - Fail-closed default is LEVEL_2 for ambiguous text
 *   - Word-boundary matching so "posture" does not match "post "
 *   - Question detection so "how to delete a file" is LEVEL_0, not LEVEL_2
 */

const { RISK_LEVEL } = require('./task-model.cjs');

/* ------------------------------------------------------------------ */
/*  Word-boundary match helper                                         */
/* ------------------------------------------------------------------ */

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match a keyword in text with word boundaries.
 * Multi-word phrases use \b at both ends.
 * Trailing-space variants are normalized.
 */
function matchKeyword(text, keyword) {
  const kw = keyword.trim();
  if (!kw) return false;
  // Build a regex: \b<kw>\b (case-insensitive). Words with symbols like `rm -rf` use looser matching.
  if (/[\s\-/]/.test(kw)) {
    // multi-token or symbols: escape and require a space or start/end
    const rx = new RegExp(`(^|\\s|/)${escapeRegex(kw)}(\\s|$|/)`, 'i');
    return rx.test(text);
  }
  const rx = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i');
  return rx.test(text);
}

/* ------------------------------------------------------------------ */
/*  Conversational pre-check (LEVEL_0) - catches greetings & chatter   */
/* ------------------------------------------------------------------ */

const CONVERSATIONAL_EXACT = new Set([
  'hi', 'hello', 'hey', 'yo', 'sup', 'hiya', 'howdy',
  'good morning', 'good afternoon', 'good evening', 'good night',
  'thanks', 'thank you', 'thx', 'ty', 'cheers',
  'ok', 'okay', 'k', 'yes', 'no', 'yep', 'nope', 'yeah', 'nah',
  'bye', 'goodbye', 'see you', 'later', 'cya',
  'how are you', 'how are you doing', 'hows it going', "how's it going",
  'whats up', "what's up", 'wassup', 'whats good',
  'test', 'testing', 'ping', 'pong', 'posture check',
  'help', 'status', 'ready', 'you there', 'you there?',
]);

const CONVERSATIONAL_PREFIXES = [
  'hi ', 'hello ', 'hey ', 'yo ', 'thanks ', 'thank you ',
  'good morning ', 'good afternoon ', 'good evening ',
];

/**
 * Return true if the normalized text is conversational-only.
 */
function isConversational(text) {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (CONVERSATIONAL_EXACT.has(t)) return true;
  // phrase like "hi jarvis" or "hello there"
  if (t.length < 40) {
    for (const p of CONVERSATIONAL_PREFIXES) {
      if (t.startsWith(p)) return true;
    }
  }
  // pure greeting+name patterns: "hi jarvis", "hey royal", "hello jarvis"
  if (/^(hi|hello|hey|yo)\s+\w{2,20}$/.test(t)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/*  Question detection (LEVEL_0)                                       */
/* ------------------------------------------------------------------ */

/**
 * A question *about* something (not a command to do it) should not be
 * treated as an action. We detect interrogative shapes:
 *   - ends with "?"
 *   - starts with wh-words: what/why/how/when/where/who/which/whose
 *   - starts with "how to", "how do i", "how can i", "explain", "tell me"
 *   - starts with "can you explain", "could you tell me"
 */
function isQuestion(text) {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  if (/^(what|why|how|when|where|who|which|whose|is|are|can|could|would|should|do|does|did|explain|tell me|show me how)\b/.test(t)) return true;
  if (/^how (to|do|can|does|would|should)\b/.test(t)) return true;
  if (/^(please\s+)?(explain|describe|summarize|clarify)\b/.test(t)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/*  Keyword table (highest risk first)                                 */
/* ------------------------------------------------------------------ */

const KEYWORD_TABLE = Object.freeze([
  {
    level: RISK_LEVEL.LEVEL_3,
    keywords: Object.freeze([
      'format drive', 'format c', 'format d', 'wipe', 'shutdown', 'shut down',
      'power off', 'restart pc', 'reboot', 'factory reset', 'uninstall',
      'reinstall', 'registry', 'regedit', 'permanent delete', 'delete permanently',
      'rm -rf', 'del /f', 'del /s', 'rmdir', 'deltree', 'partition',
      'encrypt drive', 'decrypt drive', 'bios', 'kill process', 'kill all',
      'disable firewall', 'disable antivirus', 'disable defender',
    ]),
  },
  {
    level: RISK_LEVEL.LEVEL_2,
    keywords: Object.freeze([
      'delete', 'remove', 'move file', 'move the file', 'rename', 'copy file',
      'create file', 'write file', 'edit file', 'modify', 'overwrite',
      'send message', 'send whatsapp', 'send email', 'send mail', 'send a',
      'post', 'publish', 'upload', 'download', 'install', 'update settings',
      'change settings', 'change password', 'schedule', 'cron', 'automation',
      'transfer', 'pay', 'purchase', 'buy', 'order', 'book',
      'compress', 'archive folder', 'organize files', 'clean up', 'empty recycle',
    ]),
  },
  {
    level: RISK_LEVEL.LEVEL_1,
    keywords: Object.freeze([
      'open', 'launch', 'start app', 'play music', 'play video', 'pause',
      'volume', 'mute', 'unmute', 'brightness', 'screenshot', 'screen shot',
      'search', 'google', 'browse', 'go to', 'navigate', 'visit',
      'type', 'scroll', 'click', 'switch window', 'minimize', 'maximize',
      'remind me', 'set reminder', 'note this', 'remember this',
    ]),
  },
  {
    level: RISK_LEVEL.LEVEL_0,
    keywords: Object.freeze([
      'what is', 'what are', 'what time', 'what date', 'who are you', 'who is',
      'tell me', 'show me', 'show', 'list', 'get', 'read', 'status',
      'cpu', 'memory', 'ram', 'battery', 'temperature', 'disk usage',
      'weather', 'define', 'explain', 'how much', 'how many', 'summarize',
      'translate', 'calculate', 'wiki', 'information', 'report',
      'system info', 'hardware', 'uptime',
    ]),
  },
]);

const LEVEL_INDEX = Object.freeze({
  LEVEL_0: 0,
  LEVEL_1: 1,
  LEVEL_2: 2,
  LEVEL_3: 3,
});

function isHigherRisk(a, b) {
  return (LEVEL_INDEX[a] ?? -1) > (LEVEL_INDEX[b] ?? -1);
}

/* ------------------------------------------------------------------ */
/*  Main classifier                                                    */
/* ------------------------------------------------------------------ */

/**
 * Classify a normalized command string.
 *
 * @param {string} command
 * @param {object} [options]
 * @param {string} [options.defaultLevel='LEVEL_2'] fail-closed default for ambiguous text
 * @returns {{ level: string, matched_keyword: string|null, reason: string }}
 */
function classifyRisk(command, options = {}) {
  const defaultLevel = LEVEL_INDEX[options.defaultLevel] !== undefined
    ? options.defaultLevel
    : RISK_LEVEL.LEVEL_2;
  const raw = String(command || '');
  const text = ` ${raw.toLowerCase()} `;

  // 1. Pure conversation -> LEVEL_0, no confirmation
  if (isConversational(raw)) {
    return {
      level: RISK_LEVEL.LEVEL_0,
      matched_keyword: null,
      reason: 'conversational input',
    };
  }

  // 2. Question about something -> LEVEL_0 (unless a LEVEL_3 destructive word is present)
  if (isQuestion(raw)) {
    // Still check for LEVEL_3 destructive intent inside a question
    for (const kw of KEYWORD_TABLE[0].keywords) {
      if (matchKeyword(text, kw)) {
        return {
          level: RISK_LEVEL.LEVEL_3,
          matched_keyword: kw,
          reason: `question with destructive keyword "${kw}"`,
        };
      }
    }
    return {
      level: RISK_LEVEL.LEVEL_0,
      matched_keyword: null,
      reason: 'question about something',
    };
  }

  // 3. Keyword table (highest-first)
  for (const row of KEYWORD_TABLE) {
    for (const kw of row.keywords) {
      if (matchKeyword(text, kw)) {
        return {
          level: row.level,
          matched_keyword: kw,
          reason: `matched "${kw}"`,
        };
      }
    }
  }

  // 4. Fail-closed
  return {
    level: defaultLevel,
    matched_keyword: null,
    reason: `no keyword match; fail-closed default ${defaultLevel}`,
  };
}

module.exports = {
  classifyRisk,
  KEYWORD_TABLE,
  LEVEL_INDEX,
  isHigherRisk,
  isConversational,
  isQuestion,
};
