import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, decodeContent, encodeContent } from '../crypto/content';

const pointer = (contentType: string) => ({ attachmentId: '00000000-0000-4000-8000-000000000000', key: 'k'.repeat(43), digest: 'd'.repeat(43), size: 10, contentType });
const data = (attachments: unknown[]) => encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, viewOnce: true, attachments } } as never);

describe('view-once wire format (specs §30.4)', () => {
  it('accepts exactly one photo or video', () => {
    expect(decodeContent(data([pointer('image/jpeg')]))).toMatchObject({ data: { viewOnce: true } });
    expect(decodeContent(data([pointer('video/mp4')]))).toMatchObject({ data: { viewOnce: true } });
  });
  it('rejects documents, albums and missing media', () => {
    expect(() => decodeContent(data([pointer('application/pdf')]))).toThrow();
    expect(() => decodeContent(data([pointer('image/jpeg'), pointer('image/png')]))).toThrow();
    expect(() => decodeContent(data([]))).toThrow();
  });
  it('validates the own-device consumed marker', () => {
    const ok = encodeContent({ v: CONTENT_VERSION, kind: 'sync', sync: { viewed: { conversationId: 'c', authorId: 'a', messageId: 'm' } } });
    expect(decodeContent(ok)).toMatchObject({ sync: { viewed: { messageId: 'm' } } });
    const bad = encodeContent({ v: CONTENT_VERSION, kind: 'sync', sync: { viewed: { conversationId: 'c' } } } as never);
    expect(() => decodeContent(bad)).toThrow();
  });
});
