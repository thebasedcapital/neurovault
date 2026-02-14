/**
 * NeuroVault OpenClaw Hook Handler
 *
 * Combines VaultGraph (knowledge graph) and BrainBox (Hebbian memory)
 * for unified memory injection into OpenClaw agent sessions.
 *
 * On agent:bootstrap, queries VaultGraph for relevant context notes
 * and injects them as additional context for the agent.
 *
 * Event shape from OpenClaw internal hooks:
 *   { type: 'agent', action: 'bootstrap', sessionKey, context: {
 *       workspaceDir, bootstrapFiles, cfg, sessionKey, sessionId, agentId
 *   }, timestamp, messages: [] }
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
    if (!CONFIG.enabled) return;

    const caps = await checkCapabilities();
    if (!caps.vaultgraph && !caps.brainbox) return;

    const cwd = event?.context?.workspaceDir || process.cwd();
    const prompt = 'workspace context and project patterns';

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

    const combined = combineResults(vgResult, bbResult);
    if (!combined) return;

    // Inject via messages array on the event
    if (!event.messages) event.messages = [];
    event.messages.push(combined);
    console.log('[neurovault] Context injected into agent bootstrap');
  } catch (err) {
    console.error(`[neurovault] Hook error: ${err.message || 'unknown'}`);
  }
};

export default handler;
