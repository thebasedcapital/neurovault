/**
 * NeuroVault OpenClaw Hook Handler
 *
 * Combines VaultGraph (knowledge graph) and BrainBox (Hebbian memory)
 * for unified memory injection into OpenClaw agent sessions.
 *
 * On command:new (session reset/start), queries both systems in parallel
 * and injects relevant context as a system message.
 *
 * Event shape from OpenClaw internal hooks:
 *   { type: 'command', action: 'new', sessionKey, context, timestamp, messages: [] }
 *
 * SECURITY: No shell execution. VaultGraph spawned via execFile (array args).
 * BrainBox imported directly. All inputs sanitized.
 */

import { recallVaultGraph } from '../../lib/vaultgraph.js';
import { recallBrainBox } from '../../lib/brainbox.js';
import {
  checkCapabilities,
  combineResults,
} from '../../lib/utils.js';

// --- Configuration from env vars ---

const CONFIG = {
  enabled: process.env.NEUROVAULT_ENABLED !== 'false',
  vaultPath: process.env.NEUROVAULT_VAULT_PATH
    || `${process.env.HOME}/.openclaw/memory`,
  vgBudget: parseInt(process.env.NEUROVAULT_VG_BUDGET || '3000', 10),
  bbBudget: parseInt(process.env.NEUROVAULT_BB_BUDGET || '5000', 10),
  minConfidence: parseFloat(process.env.NEUROVAULT_MIN_CONFIDENCE || '0.5'),
};

// --- Main Handler ---

const handler = async (event) => {
  try {
    // Master kill switch
    if (!CONFIG.enabled) return;

    // Check what's available (cached after first call)
    const caps = await checkCapabilities();
    if (!caps.vaultgraph && !caps.brainbox) return;

    // Extract working directory from event context
    const cwd = event?.context?.cfg?.agents?.defaults?.workspace || process.cwd();

    // Use sessionKey as the prompt context hint
    // For command:new, the actual user message may not be in the event
    // Use a generic context query based on workspace
    const prompt = event?.context?.senderId || event?.sessionKey || 'general context';

    // Query both systems in parallel
    const [vgResult, bbResult] = await Promise.allSettled([
      caps.vaultgraph
        ? recallVaultGraph(prompt, {
            vaultPath: CONFIG.vaultPath,
            budget: CONFIG.vgBudget,
          })
        : Promise.resolve(null),

      caps.brainbox
        ? recallBrainBox(prompt, {
            cwd,
            budget: CONFIG.bbBudget,
            minConfidence: CONFIG.minConfidence,
          })
        : Promise.resolve(null),
    ]);

    // Combine results
    const combined = combineResults(vgResult, bbResult);
    if (!combined) return;

    // Inject as message on the event (OpenClaw reads event.messages after hook)
    if (!event.messages) event.messages = [];
    event.messages.push(combined);
    console.log('[neurovault] Context injected into session');
  } catch (err) {
    // Never crash OpenClaw
    console.error(`[neurovault] Hook error: ${err.message || 'unknown'}`);
  }
};

export default handler;
