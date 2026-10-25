import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, decodeContent, encodeContent } from '../crypto/content';
import { applyPolicy, mayPost } from './memberPolicy';

describe('member restrictions and slow mode', () => {
  const v1 = { slowModeSeconds: 30, restricted: ['bob'], revision: 1 };
  const v2 = { slowModeSeconds: 0, restricted: [], revision: 2 };
  it('converges on the highest revision regardless of order', () => {
    expect(applyPolicy(applyPolicy(undefined, v1), v2)).toEqual(applyPolicy(applyPolicy(undefined, v2), v1));
    expect(applyPolicy(applyPolicy(undefined, v2), v1)).toMatchObject({ revision: 2, restricted: [] });
  });
  it('restricted members cannot post; admins always can', () => {
    expect(mayPost(v1, 'bob', false, undefined, 0)).toEqual({ ok: false, reason: 'restricted' });
    expect(mayPost(v1, 'bob', true, undefined, 0)).toEqual({ ok: true });
    expect(mayPost(undefined, 'bob', false, undefined, 0)).toEqual({ ok: true });
  });
  it('slow mode spaces posts by the interval, with receiver tolerance', () => {
    expect(mayPost(v1, 'amy', false, undefined, 1000)).toEqual({ ok: true });
    expect(mayPost(v1, 'amy', false, 1000, 20_000)).toEqual({ ok: false, reason: 'slow', retryAt: 31_000 });
    expect(mayPost(v1, 'amy', false, 1000, 29_500, 2000)).toEqual({ ok: true });
    expect(mayPost(v1, 'amy', false, 1000, 31_000)).toEqual({ ok: true });
  });
  it('validates the policy event on the wire', () => {
    const ok = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, memberPolicy: v1 } });
    expect(decodeContent(ok)).toMatchObject({ data: { memberPolicy: { slowModeSeconds: 30 } } });
    const bad = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, memberPolicy: { ...v1, slowModeSeconds: -5 } } });
    expect(() => decodeContent(bad)).toThrow();
  });
});
