/**
 * VaultGraph Integration
 *
 * Spawns the vaultgraph Rust CLI in hook mode.
 * Sends prompt via stdin, reads formatted context from stdout.
 * <5ms typical response time.
 */

import { spawn } from 'child_process';

const TIMEOUT_MS = 2000;
const MAX_OUTPUT_BYTES = 64 * 1024; // 64KB max

let _errorLogged = false;

/**
 * Query VaultGraph for relevant knowledge graph context.
 *
 * @param {string} prompt - User's initial prompt
 * @param {object} opts
 * @param {string} opts.vaultPath - Path to the markdown vault
 * @param {number} opts.budget - Token budget for context selection
 * @returns {Promise<string|null>} Formatted context or null
 */
export async function recallVaultGraph(prompt, opts) {
  const { vaultPath, budget } = opts;

  if (!prompt || !vaultPath) return null;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;
    let outputBytes = 0;

    const done = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      done(null);
    }, TIMEOUT_MS);

    // Spawn vaultgraph in hook mode
    // --vault must come BEFORE the subcommand (global flag)
    const proc = spawn('vaultgraph', [
      '--vault', vaultPath,
      'hook',
      '--budget', String(budget),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
    });

    proc.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) {
        stdout += chunk;
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    proc.on('error', (err) => {
      if (!_errorLogged) {
        console.error(`[neurovault] VaultGraph spawn error: ${err.message}`);
        _errorLogged = true;
      }
      clearTimeout(timer);
      done(null);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        if (!_errorLogged) {
          console.warn(`[neurovault] VaultGraph exited ${code}: ${stderr.slice(0, 200)}`);
          _errorLogged = true;
        }
        done(null);
        return;
      }

      const output = stdout.trim();
      // VaultGraph hook mode is silent when no results
      if (!output || output.length < 10) {
        done(null);
        return;
      }

      done(output);
    });

    // Send prompt as JSON via stdin (hook mode reads from stdin)
    proc.stdin.write(JSON.stringify({ prompt }));
    proc.stdin.end();
  });
}
