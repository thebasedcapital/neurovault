#!/usr/bin/env node

/**
 * NeuroVault dependency health check.
 * Run: node bin/check-deps.js
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function main() {
  console.log('[neurovault] Installation check:\n');

  let hasVG = false;
  let hasBB = false;

  // Check VaultGraph
  try {
    await execFileAsync('which', ['vaultgraph'], { timeout: 2000 });
    console.log('  \u2713 VaultGraph found');
    hasVG = true;
  } catch {
    console.log('  \u2717 VaultGraph not found');
    console.log('    Install: brew install vaultgraph');
    console.log('    Or build from: https://github.com/slopus/vaultgraph');
  }

  console.log('');

  // Check BrainBox
  try {
    const mod = await import('brainbox/dist/adapter.js');
    if (typeof mod.performRecall === 'function') {
      console.log('  \u2713 BrainBox found (performRecall available)');
      hasBB = true;
    } else {
      throw new Error('performRecall not exported');
    }
  } catch {
    // Try dev path
    try {
      const devPath = `${process.env.HOME}/happy-cli-new/brainbox/dist/adapter.js`;
      const mod = await import(devPath);
      if (typeof mod.performRecall === 'function') {
        console.log(`  \u2713 BrainBox found (dev: ${devPath})`);
        hasBB = true;
      }
    } catch {
      console.log('  \u2717 BrainBox not found');
      console.log('    Install: npm install -g brainbox');
      console.log('    Or build from: https://github.com/slopus/brainbox');
    }
  }

  console.log('');

  if (!hasVG && !hasBB) {
    console.log('\u26a0\ufe0f  Warning: Install at least one memory backend for NeuroVault to function.');
    console.log('  VaultGraph = knowledge graph (<5ms)');
    console.log('  BrainBox = Hebbian file patterns (~100ms)');
    console.log('  Both together = complete agent memory\n');
    process.exit(1);
  }

  if (hasVG && hasBB) {
    console.log('\u2713 NeuroVault ready — full unified memory (VaultGraph + BrainBox)');
  } else if (hasVG) {
    console.log('\u2713 NeuroVault ready — knowledge graph only (add BrainBox for file pattern learning)');
  } else {
    console.log('\u2713 NeuroVault ready — Hebbian memory only (add VaultGraph for knowledge graph)');
  }
}

main().catch((err) => {
  console.error(`[neurovault] Check failed: ${err.message}`);
  process.exit(1);
});
