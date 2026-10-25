import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, decodeContent, encodeContent } from '../crypto/content';
import { applyTopic, canPostInTopic } from './topics';

describe('group topics (specs §30.4)', () => {
  it('higher revisions win regardless of order; stale ones are ignored', () => {
    const a = applyTopic(applyTopic(undefined, { id: 't1', name: 'Design', closed: false, revision: 1 }), { id: 't1', name: 'Design (closed)', closed: true, revision: 2 });
    const b = applyTopic(applyTopic(undefined, { id: 't1', name: 'Design (closed)', closed: true, revision: 2 }), { id: 't1', name: 'Design', closed: false, revision: 1 });
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ name: 'Design (closed)', closed: true });
  });
  it('closed topics are read-only except for admins', () => {
    const t = { id: 't', name: 'x', closed: true, revision: 1 };
    expect(canPostInTopic(t, false)).toBe(false);
    expect(canPostInTopic(t, true)).toBe(true);
    expect(canPostInTopic(undefined, false)).toBe(true);
  });
  it('validates topic definitions and message topic IDs on the wire', () => {
    const ok = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, topicDef: { id: 't1', name: 'Launch', closed: false, revision: 1 } } });
    expect(decodeContent(ok)).toMatchObject({ data: { topicDef: { name: 'Launch' } } });
    const bad = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, body: 'x', topic: 'bad id!' } });
    expect(() => decodeContent(bad)).toThrow();
  });
});
