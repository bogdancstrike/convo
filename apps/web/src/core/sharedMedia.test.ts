import { describe, expect, it } from 'vitest';
import { downloadName, filterShared, selectedMessages, sharedEntries } from './sharedMedia';
import type { ChatMessage, Conversation } from './model';
const chat: Conversation = { id: 'peer', title: 'Team', kind: 'direct', lastActivity: 2, unread: 0, pinned: false, muted: false, archived: false };
const photo = { attachmentId: 'photo', key: 'key', digest: 'digest', size: 100, contentType: 'image/png', fileName: 'photo.png' };
const document = { ...photo, attachmentId: 'doc', size: 900, contentType: 'text/plain', fileName: 'report.txt' };
const first: ChatMessage = { conversationId: chat.id, id: 'one', authorId: 'self', direction: 'out', body: 'Ședință https://example.test/a', attachments: [photo, document], sentAt: 1, sort: 1, reactions: {} };
const second: ChatMessage = { ...first, id: 'two', authorId: 'peer', direction: 'in', body: 'Beach https://example.test/b', attachments: [{ ...photo, attachmentId: 'second', size: 200 }], sentAt: 2 };
describe('all-chat shared content', () => {
  const entries = sharedEntries([first, second, { ...first, id: 'deleted', deleted: true }], [chat]);
  it('filters safely by content type, normalized caption and sender; sorts by time or size', () => {
    expect(entries).toHaveLength(5);
    const base = { tab: 'media' as const, query: '', sender: 'all' as const, sort: 'newest' as const };
    expect(filterShared(entries, base, 'self').map((e) => e.attachment!.attachmentId)).toEqual(['second', 'photo']);
    expect(filterShared(entries, { ...base, query: 'SEDINTA' }, 'self')).toHaveLength(1);
    expect(filterShared(entries, { ...base, sender: 'others' }, 'self')[0]!.message.authorId).toBe('peer');
    expect(filterShared(entries, { ...base, sort: 'oldest' }, 'self')[0]!.message.id).toBe('one');
    expect(filterShared(entries, { ...base, tab: 'docs', sort: 'largest' }, 'self')[0]!.size).toBe(900);
    expect(filterShared(entries, { ...base, tab: 'links' }, 'self')).toHaveLength(2);
  });
  it('forwards only selected attachments or links and leaves source messages intact', () => {
    const selected = selectedMessages(entries.filter((entry) => entry.attachment?.attachmentId === 'photo'));
    expect(selected[0]!.attachments).toEqual([photo]);
    expect(selected[0]!.body).toBe(first.body);
    expect(first.attachments).toEqual([photo, document]);
    expect(selectedMessages(entries.filter((entry) => entry.link === 'https://example.test/a'))[0]!.body).toBe('https://example.test/a');
  });
  it('prevents directory segments and duplicate archive names', () => {
    expect(downloadName('../../secret.txt', 0)).not.toMatch(/[\\/]/);
    expect(downloadName('../../secret.txt', 0)).toContain('secret.txt');
    expect(downloadName('photo.png', 0)).not.toBe(downloadName('photo.png', 1));
    expect(downloadName('a\\b/c.txt', 1)).toBe('002-a_b_c.txt');
  });
});
