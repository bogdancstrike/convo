import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from './navigation';

describe('hash navigation', () => {
  it.each([
    ['#/', { panel: 'chats', chat: null, info: false, page: null }],
    ['', { panel: 'chats', chat: null, info: false, page: null }],
    ['#/settings', { panel: 'settings', chat: null, info: false, page: null }],
    ['#/settings/privacy', { panel: 'settings', chat: null, info: false, page: 'privacy' }],
    ['#/chat/g%3Aabc/info/media', { panel: 'chats', chat: 'g:abc', info: true, page: 'media' }],
    ['#/calls', { panel: 'calls', chat: null, info: false, page: null }],
    ['#/channels', { panel: 'channels', chat: null, info: false, page: null }],
    ['#/new-group', { panel: 'new-group', chat: null, info: false, page: null }],
    ['#/chat/g%3AabcDEF-_', { panel: 'chats', chat: 'g:abcDEF-_', info: false, page: null }],
    ['#/chat/3f1c2a7e-6b1d-4c2e-9a55-0d6f3e2b1a90/info', { panel: 'chats', chat: '3f1c2a7e-6b1d-4c2e-9a55-0d6f3e2b1a90', info: true, page: null }],
  ])('parses %s', (hash, state) => {
    expect(parseHash(hash)).toEqual(state);
  });

  it('round-trips chat routes', () => {
    const state = { panel: 'chats' as const, chat: 'g:x/y', info: true, page: null };
    expect(parseHash(formatHash(state))).toEqual(state);
  });
});
