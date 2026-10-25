import { describe, expect, it } from 'vitest';
import { folderMatches, sanitizeFolders } from './folders';
import type { Conversation } from './model';

const chat = (id: string, kind: Conversation['kind'], extra: Partial<Conversation> = {}): Conversation =>
  ({ id, title: id, kind, pinned: false, muted: false, archived: false, unread: 0, lastActivity: 1, ...extra }) as Conversation;

describe('chat folders (specs §30.4)', () => {
  it('matches explicit chats and type filters, optionally only unread', () => {
    const work = { id: 'f1', name: 'Work', chats: ['ana'], types: ['channel' as const], unreadOnly: false };
    expect(folderMatches(work, chat('ana', 'direct'))).toBe(true);
    expect(folderMatches(work, chat('bob', 'direct'))).toBe(false);
    expect(folderMatches(work, chat('g:news', 'group', { adminOnly: true }))).toBe(true);
    expect(folderMatches(work, chat('g:team', 'group'))).toBe(false);
    expect(folderMatches({ ...work, unreadOnly: true }, chat('ana', 'direct'))).toBe(false);
    expect(folderMatches({ ...work, unreadOnly: true }, chat('ana', 'direct', { unread: 2 }))).toBe(true);
  });
  it('sanitizes folders from other devices: names, ids, types, limits', () => {
    expect(sanitizeFolders([{ id: 'ok', name: '  Family  ', chats: ['a', 'a', 7], types: ['group', 'bogus'], unreadOnly: 'yes' }, { id: 'bad id!', name: 'x' }, { id: 'n', name: '' }]))
      .toEqual([{ id: 'ok', name: 'Family', chats: ['a'], types: ['group'], unreadOnly: false }]);
    expect(sanitizeFolders(Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, chats: [], types: [] })))).toHaveLength(10);
    expect(sanitizeFolders('nope')).toEqual([]);
  });
});
