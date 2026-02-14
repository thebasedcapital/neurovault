import { describe, it, expect } from 'vitest';
import {
  extractPrompt,
  sanitizePrompt,
  combineResults,
  eventMatches,
  injectSystemMessage,
} from '../lib/utils.js';

describe('extractPrompt', () => {
  it('should extract from messages array', () => {
    const event = {
      messages: [{ role: 'user', content: 'fix the auth bug' }],
    };
    expect(extractPrompt(event)).toBe('fix the auth bug');
  });

  it('should extract from context.initialPrompt', () => {
    const event = {
      context: { initialPrompt: 'debug websocket' },
      messages: [],
    };
    expect(extractPrompt(event)).toBe('debug websocket');
  });

  it('should handle multi-part content', () => {
    const event = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'fix the' },
          { type: 'text', text: 'auth bug' },
        ],
      }],
    };
    expect(extractPrompt(event)).toBe('fix the auth bug');
  });

  it('should skip non-user messages', () => {
    const event = {
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'fix the auth bug' },
      ],
    };
    expect(extractPrompt(event)).toBe('fix the auth bug');
  });

  it('should return null for empty messages', () => {
    expect(extractPrompt({ messages: [] })).toBeNull();
  });

  it('should return null for no event', () => {
    expect(extractPrompt(null)).toBeNull();
    expect(extractPrompt(undefined)).toBeNull();
  });
});

describe('sanitizePrompt', () => {
  it('should strip control characters', () => {
    expect(sanitizePrompt('hello\x00world\x1f!')).toBe('hello world !');
  });

  it('should normalize whitespace', () => {
    expect(sanitizePrompt('hello   world\n\ttab')).toBe('hello world tab');
  });

  it('should limit length to 500', () => {
    const long = 'a'.repeat(600);
    expect(sanitizePrompt(long)).toHaveLength(500);
  });

  it('should handle non-strings', () => {
    expect(sanitizePrompt(null)).toBe('');
    expect(sanitizePrompt(42)).toBe('');
  });
});

describe('combineResults', () => {
  it('should combine both results', () => {
    const vg = { status: 'fulfilled', value: '[vaultgraph] context found' };
    const bb = { status: 'fulfilled', value: '[brainbox] files recalled' };

    const result = combineResults(vg, bb);
    expect(result).toContain('[neurovault]');
    expect(result).toContain('vaultgraph');
    expect(result).toContain('brainbox');
  });

  it('should handle VaultGraph only', () => {
    const vg = { status: 'fulfilled', value: '[vaultgraph] context found' };
    const bb = { status: 'fulfilled', value: null };

    const result = combineResults(vg, bb);
    expect(result).toContain('vaultgraph');
    expect(result).not.toContain('brainbox');
  });

  it('should handle BrainBox only', () => {
    const vg = { status: 'fulfilled', value: null };
    const bb = { status: 'fulfilled', value: '[brainbox] files recalled' };

    const result = combineResults(vg, bb);
    expect(result).toContain('brainbox');
  });

  it('should return null when both empty', () => {
    const vg = { status: 'fulfilled', value: null };
    const bb = { status: 'fulfilled', value: null };

    expect(combineResults(vg, bb)).toBeNull();
  });

  it('should handle rejected promises', () => {
    const vg = { status: 'rejected', reason: new Error('fail') };
    const bb = { status: 'fulfilled', value: '[brainbox] files recalled' };

    const result = combineResults(vg, bb);
    expect(result).toContain('brainbox');
  });
});

describe('eventMatches', () => {
  it('should match direct type/action', () => {
    expect(eventMatches({ type: 'session', action: 'start' }, 'session', 'start')).toBe(true);
  });

  it('should not match wrong action', () => {
    expect(eventMatches({ type: 'session', action: 'end' }, 'session', 'start')).toBe(false);
  });

  it('should match event alias', () => {
    expect(eventMatches({ event: 'session:start' }, 'session', 'start')).toBe(true);
  });

  it('should match dot-separated alias', () => {
    expect(eventMatches({ name: 'session.start' }, 'session', 'start')).toBe(true);
  });

  it('should handle null/undefined', () => {
    expect(eventMatches(null, 'session', 'start')).toBe(false);
    expect(eventMatches(undefined, 'session', 'start')).toBe(false);
  });
});

describe('injectSystemMessage', () => {
  it('should push system message', () => {
    const event = { messages: [{ role: 'user', content: 'hi' }] };
    const result = injectSystemMessage(event, 'context here');

    expect(result).toBe(true);
    expect(event.messages).toHaveLength(2);
    expect(event.messages[1]).toEqual({ role: 'system', content: 'context here' });
  });

  it('should return false for missing messages array', () => {
    expect(injectSystemMessage({}, 'test')).toBe(false);
    expect(injectSystemMessage(null, 'test')).toBe(false);
  });
});
