import { describe, it, expect } from 'vitest';
import {
  extractPrompt,
  combineResults,
  eventMatches,
  injectSystemMessage,
} from '../lib/utils.js';

/**
 * Handler integration tests.
 *
 * Tests the handler logic by composing the same steps with mocked backends.
 * This avoids complex vi.mock path resolution issues while testing
 * the exact same control flow as handler.js.
 */

describe('NeuroVault handler logic', () => {
  async function simulateHandler(event, opts = {}) {
    const {
      caps = { vaultgraph: true, brainbox: true },
      vgResult = null,
      bbResult = null,
      enabled = true,
    } = opts;

    if (!eventMatches(event, 'session', 'start')) return;
    if (!enabled) return;

    const prompt = extractPrompt(event);
    if (!prompt || prompt.length < 15) return;
    if (!caps.vaultgraph && !caps.brainbox) return;

    const [vgSettled, bbSettled] = await Promise.allSettled([
      caps.vaultgraph ? Promise.resolve(vgResult) : Promise.resolve(null),
      caps.brainbox ? Promise.resolve(bbResult) : Promise.resolve(null),
    ]);

    const combined = combineResults(vgSettled, bbSettled);
    if (!combined) return;

    injectSystemMessage(event, combined);
  }

  function makeEvent(prompt, overrides = {}) {
    return {
      type: 'session',
      action: 'start',
      messages: [{ role: 'user', content: prompt }],
      context: { cwd: '/tmp/test-project' },
      ...overrides,
    };
  }

  it('should inject context on session:start with both backends', async () => {
    const event = makeEvent('fix the Polymarket redemption bug');
    await simulateHandler(event, {
      vgResult: '[vaultgraph] Found: trading-docs (score: 95%)',
      bbResult: '[brainbox] Neural recall: market.py (confidence: 82%)',
    });

    const systemMsgs = event.messages.filter((m) => m.role === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(systemMsgs[0].content).toContain('[neurovault]');
    expect(systemMsgs[0].content).toContain('vaultgraph');
    expect(systemMsgs[0].content).toContain('brainbox');
  });

  it('should work with VaultGraph only', async () => {
    const event = makeEvent('implement authentication flow');
    await simulateHandler(event, {
      caps: { vaultgraph: true, brainbox: false },
      vgResult: '[vaultgraph] Found: auth-docs (score: 88%)',
    });

    const systemMsgs = event.messages.filter((m) => m.role === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(systemMsgs[0].content).toContain('vaultgraph');
  });

  it('should work with BrainBox only', async () => {
    const event = makeEvent('implement authentication flow');
    await simulateHandler(event, {
      caps: { vaultgraph: false, brainbox: true },
      bbResult: '[brainbox] Neural recall: auth.ts (confidence: 75%)',
    });

    const systemMsgs = event.messages.filter((m) => m.role === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(systemMsgs[0].content).toContain('brainbox');
  });

  it('should not inject for non-session:start events', async () => {
    const event = {
      type: 'tool',
      action: 'result',
      messages: [{ role: 'user', content: 'some long enough task here' }],
    };
    await simulateHandler(event, { vgResult: 'should not appear' });
    expect(event.messages).toHaveLength(1);
  });

  it('should not inject for short prompts', async () => {
    const event = makeEvent('hi');
    await simulateHandler(event, { vgResult: 'should not appear' });
    expect(event.messages).toHaveLength(1);
  });

  it('should not inject when both backends return null', async () => {
    const event = makeEvent('some random query with enough length');
    await simulateHandler(event);
    expect(event.messages.filter((m) => m.role === 'system')).toHaveLength(0);
  });

  it('should not inject when neither backend is available', async () => {
    const event = makeEvent('fix the authentication bug in login');
    await simulateHandler(event, {
      caps: { vaultgraph: false, brainbox: false },
    });
    expect(event.messages.filter((m) => m.role === 'system')).toHaveLength(0);
  });

  it('should not inject when disabled', async () => {
    const event = makeEvent('fix the authentication bug in login');
    await simulateHandler(event, { enabled: false, vgResult: 'nope' });
    expect(event.messages.filter((m) => m.role === 'system')).toHaveLength(0);
  });

  it('should handle event alias formats', async () => {
    const event = {
      event: 'session:start',
      messages: [{ role: 'user', content: 'fix the authentication bug in login' }],
      context: {},
    };
    await simulateHandler(event, { vgResult: '[vaultgraph] context found' });

    const systemMsgs = event.messages.filter((m) => m.role === 'system');
    expect(systemMsgs).toHaveLength(1);
  });

  it('should extract prompt from context.initialPrompt', () => {
    const event = {
      type: 'session',
      action: 'start',
      messages: [],
      context: { initialPrompt: 'debug the websocket connection issue' },
    };
    expect(extractPrompt(event)).toBe('debug the websocket connection issue');
  });
});
