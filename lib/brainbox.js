/**
 * BrainBox Integration
 *
 * Dynamically imports BrainBox's performRecall() for Hebbian memory recall.
 * Falls back gracefully if BrainBox is not installed.
 */

let _performRecall = null;
let _importAttempted = false;
let _errorLogged = false;

/**
 * Lazy-load the BrainBox performRecall function.
 * Caches the import result (success or failure).
 */
async function loadPerformRecall() {
  if (_importAttempted) return _performRecall;
  _importAttempted = true;

  try {
    // Try the installed package first
    const mod = await import('brainbox/dist/adapter.js');
    if (typeof mod.performRecall === 'function') {
      _performRecall = mod.performRecall;
      return _performRecall;
    }
  } catch {
    // Not installed as package
  }

  // Try absolute path (dev environment)
  const devPath = `${process.env.HOME}/happy-cli-new/brainbox/dist/adapter.js`;
  try {
    const mod = await import(devPath);
    if (typeof mod.performRecall === 'function') {
      _performRecall = mod.performRecall;
      return _performRecall;
    }
  } catch {
    // Not available
  }

  return null;
}

/**
 * Query BrainBox for Hebbian memory recall.
 *
 * @param {string} prompt - User's initial prompt
 * @param {object} opts
 * @param {string} [opts.cwd] - Working directory for project scoping
 * @param {number} [opts.budget=5000] - Token budget
 * @param {number} [opts.minConfidence=0.5] - Minimum confidence threshold
 * @returns {Promise<string|null>} Formatted recall results or null
 */
export async function recallBrainBox(prompt, opts = {}) {
  const {
    cwd = process.cwd(),
    budget = 5000,
    minConfidence = 0.5,
  } = opts;

  if (!prompt) return null;

  const performRecall = await loadPerformRecall();
  if (!performRecall) {
    if (!_errorLogged) {
      console.warn('[neurovault] BrainBox not available (performRecall not found)');
      _errorLogged = true;
    }
    return null;
  }

  try {
    const result = await performRecall(prompt, {
      type: 'file',
      limit: 5,
      token_budget: budget,
      minConfidence,
      cwd,
    });

    return result; // Already formatted string or null
  } catch (err) {
    if (!_errorLogged) {
      console.error(`[neurovault] BrainBox recall error: ${err.message}`);
      _errorLogged = true;
    }
    return null;
  }
}

/** Reset cached state (for testing) */
export function resetBrainBox() {
  _performRecall = null;
  _importAttempted = false;
  _errorLogged = false;
}
