/**
 * NeuroVault Utilities
 *
 * Capabilities detection, result combination, input sanitization.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAX_PROMPT_LENGTH = 500;

// --- Capabilities (cached after first check) ---

let _capabilities = null;

/**
 * Detect which memory backends are available.
 * Results are cached — only checks once per process.
 */
export async function checkCapabilities() {
  if (_capabilities) return _capabilities;

  const caps = { vaultgraph: false, brainbox: false };

  // Check VaultGraph binary
  try {
    await execFileAsync('which', ['vaultgraph'], { timeout: 2000 });
    caps.vaultgraph = true;
  } catch {
    // not installed
  }

  // Check BrainBox module
  try {
    const mod = await import('brainbox/dist/adapter.js');
    if (typeof mod.performRecall === 'function') {
      caps.brainbox = true;
    }
  } catch {
    // not installed or can't import
  }

  _capabilities = caps;

  if (!caps.vaultgraph && !caps.brainbox) {
    console.error('[neurovault] Neither VaultGraph nor BrainBox found. Install at least one.');
  } else {
    const parts = [];
    if (caps.vaultgraph) parts.push('VaultGraph');
    if (caps.brainbox) parts.push('BrainBox');
    console.log(`[neurovault] Ready with: ${parts.join(' + ')}`);
  }

  return caps;
}

/** Reset cached capabilities (for testing) */
export function resetCapabilities() {
  _capabilities = null;
}

// --- Prompt Extraction ---

/**
 * Extract the user's initial prompt from an OpenClaw event.
 * Handles multiple event shapes (role-based, type-based, string messages).
 */
export function extractPrompt(event) {
  // Try context.initialPrompt first
  const fromContext = event?.context?.initialPrompt;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return sanitizePrompt(fromContext);
  }

  // Search messages array for first user message
  const messageSources = [
    event?.messages,
    event?.context?.messages,
    event?.context?.initialMessages,
  ];

  for (const messages of messageSources) {
    if (!Array.isArray(messages)) continue;

    for (const msg of messages) {
      if (!isUserMessage(msg)) continue;
      const text = extractTextFromMessage(msg);
      if (text) return sanitizePrompt(text);
    }
  }

  return null;
}

function isUserMessage(msg) {
  if (typeof msg === 'string') return true;
  if (!msg || typeof msg !== 'object') return false;
  const role = String(msg.role || '').toLowerCase();
  const type = String(msg.type || '').toLowerCase();
  return role === 'user' || role === 'human' || type === 'user';
}

function extractTextFromMessage(msg) {
  if (typeof msg === 'string') return msg;
  if (!msg || typeof msg !== 'object') return '';

  const content = msg.content ?? msg.text ?? msg.message;
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') return part.text || part.content || '';
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }

  return '';
}

// --- Sanitization ---

/**
 * Sanitize a prompt for passing to CLI tools.
 * Strips control chars, normalizes whitespace, limits length.
 */
export function sanitizePrompt(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROMPT_LENGTH);
}

/**
 * Sanitize output for display (prevent prompt injection via control chars).
 */
export function sanitizeForDisplay(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, 2000);
}

// --- Result Combination ---

/**
 * Combine VaultGraph and BrainBox results into a single injection message.
 * @param {PromiseSettledResult} vgResult
 * @param {PromiseSettledResult} bbResult
 * @returns {string|null}
 */
export function combineResults(vgResult, bbResult) {
  const vgText = vgResult?.status === 'fulfilled' ? vgResult.value : null;
  const bbText = bbResult?.status === 'fulfilled' ? bbResult.value : null;

  if (!vgText && !bbText) return null;

  const parts = ['[neurovault] Unified memory context for this session:'];
  parts.push('');

  if (vgText) {
    parts.push(sanitizeForDisplay(vgText));
    parts.push('');
  }

  if (bbText) {
    parts.push(sanitizeForDisplay(bbText));
    parts.push('');
  }

  return parts.join('\n').trimEnd();
}

// --- Event Matching ---

/**
 * Check if an event matches a type/action pair.
 * Tolerates various OpenClaw event shapes.
 */
export function eventMatches(event, type, action) {
  if (!event || typeof event !== 'object') return false;

  // Direct match
  const eType = String(event.type || '').toLowerCase();
  const eAction = String(event.action || '').toLowerCase();
  if (eType === type && eAction === action) return true;

  // Alias fields (OpenClaw wrappers may use different shapes)
  const aliases = [event.event, event.name, event.hook, event.trigger, event.eventName];
  const expected = `${type}:${action}`;

  for (const alias of aliases) {
    if (typeof alias !== 'string') continue;
    const normalized = alias.toLowerCase().replace(/[.:/]/g, ':');
    if (normalized === expected) return true;
  }

  return false;
}

// --- System Message Injection ---

/**
 * Push a system message into an event's messages array.
 */
export function injectSystemMessage(event, content) {
  if (!event || !Array.isArray(event.messages)) return false;
  event.messages.push({ role: 'system', content });
  return true;
}
