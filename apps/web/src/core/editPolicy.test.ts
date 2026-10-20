import { afterEach, describe, expect, it } from 'vitest';
import { decodeContent, encodeContent, CONTENT_VERSION } from '../crypto/content';
import { acceptsEdit, canEdit, configureEditPolicy, DEFAULT_EDIT_POLICY, editableUntil, editPolicy } from './editPolicy';
import { mergeArchivedMessage } from './history';
import type { ChatMessage } from './model';

const MIN = 60_000;
const chat = { kind: 'direct' as const };
const channel = { kind: 'group' as const, adminOnly: true };
const own: ChatMessage = { conversationId: 'peer', id: 'm1', authorId: 'self', direction: 'out', body: 'hello', sentAt: 1_000, sort: 1_000, reactions: {} };
const incoming: ChatMessage = { ...own, authorId: 'peer', direction: 'in', serverAt: 2_000, sort: 2_000 };

afterEach(() => configureEditPolicy(undefined));

describe('edit policy', () => {
  it('uses 15 minutes for chats and 30 days for channels, configurable by the deployment', () => {
    expect(editPolicy()).toEqual(DEFAULT_EDIT_POLICY);
    expect(editableUntil(own, chat, 'self')).toBe(1_000 + 15 * MIN);
    expect(editableUntil(own, channel, 'self')).toBe(1_000 + 30 * 24 * 60 * MIN);
    configureEditPolicy({ editWindowMs: 2 * MIN, channelEditWindowMs: -1, editGraceMs: 0 });
    expect(editPolicy()).toEqual({ windowMs: 2 * MIN, channelWindowMs: DEFAULT_EDIT_POLICY.channelWindowMs, graceMs: 0 });
  });

  it('offers edit only for own, undeleted text before the window closes', () => {
    expect(canEdit(own, chat, 'self', 1_000 + 15 * MIN - 1)).toBe(true);
    expect(canEdit(own, chat, 'self', 1_000 + 15 * MIN)).toBe(false);
    expect(canEdit(incoming, chat, 'self', 2_001)).toBe(false);
    expect(canEdit({ ...own, body: undefined, attachments: [] }, chat, 'self', 1_001)).toBe(false);
    expect(canEdit({ ...own, deleted: true }, chat, 'self', 1_001)).toBe(false);
  });

  it('receivers enforce the window with server timestamps plus grace, and reject stale or invalid revisions', () => {
    const limit = 2_000 + 15 * MIN + 5 * MIN;
    expect(acceptsEdit(incoming, chat, ' fixed ', 1, 0, limit)).toBe('fixed');
    expect(acceptsEdit(incoming, chat, 'fixed', 1, 0, limit + 1)).toBeUndefined();
    expect(acceptsEdit(incoming, channel, 'fixed', 1, 0, 2_000 + 29 * 24 * 60 * MIN)).toBe('fixed');
    expect(acceptsEdit({ ...incoming, revision: 2 }, chat, 'older', 2, 0, 3_000)).toBeUndefined();
    expect(acceptsEdit({ ...incoming, revision: 2 }, chat, 'newer', 3, 0, 3_000)).toBe('newer');
    expect(acceptsEdit(incoming, chat, '   ', 1, 0, 3_000)).toBeUndefined();
    expect(acceptsEdit(incoming, chat, 'hello', 1, 0, 3_000)).toBeUndefined();
    expect(acceptsEdit(incoming, chat, 'x'.repeat(64 * 1024 + 1), 1, 0, 3_000)).toBeUndefined();
    expect(acceptsEdit({ ...incoming, body: undefined }, chat, 'caption', 1, 0, 3_000)).toBeUndefined();
    // Legacy edits without revisions are ordered by time and cannot override revisioned content.
    expect(acceptsEdit({ ...incoming, editedAt: 50 }, chat, 'legacy', undefined, 40, 3_000)).toBeUndefined();
    expect(acceptsEdit({ ...incoming, revision: 1 }, chat, 'legacy', undefined, 99, 3_000)).toBeUndefined();
  });

  it('validates edit revisions and per-message receipt revisions on the wire', () => {
    const ok = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'e', timestamp: 1, edit: { targetMessageId: 'm1', body: 'new', revision: 2 } } });
    expect(decodeContent(ok)).toMatchObject({ kind: 'data', data: { edit: { revision: 2 } } });
    const badEdit = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'e', timestamp: 1, edit: { targetMessageId: 'm1', body: 'new', revision: -1 } } });
    expect(() => decodeContent(badEdit)).toThrow();
    const receipt = (revisions: unknown) => encodeContent({ v: CONTENT_VERSION, kind: 'receipt', receipt: { type: 'read', messageIds: ['a', 'b'], timestamp: 1, revisions } as never });
    expect(decodeContent(receipt([0, 3]))).toMatchObject({ receipt: { revisions: [0, 3] } });
    expect(() => decodeContent(receipt([1]))).toThrow();
  });

  it('archive merge keeps the newest revision and only that revision’s receipts', () => {
    const original = { ...own, status: 'read' as const, receipts: { peer: { deliveredAt: 10, readAt: 20 } } };
    const edited = { ...own, body: 'fixed', revision: 1, editedAt: 30, status: 'sent' as const, receipts: undefined };
    for (const merged of [mergeArchivedMessage(original, edited), mergeArchivedMessage(edited, original)]) {
      expect(merged).toMatchObject({ body: 'fixed', revision: 1, status: 'sent' });
      expect(merged.receipts).toBeUndefined();
    }
  });
});
