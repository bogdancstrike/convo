import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, decodeContent, encodeContent } from '../crypto/content';
import { newMediaKey, nextStatus, rekeyLeader, supersedes } from './calls';

const callId = '0f5c1a9e-1d2b-4c3d-8e9f-0a1b2c3d4e5f';

it('validates call signalling and requires a 256-bit media key on rings', () => {
  const key = newMediaKey();
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const ring = encodeContent({ v: CONTENT_VERSION, kind: 'call', call: { callId, action: 'ring', video: true, key, to: 'peer', timestamp: 1 } });
  expect(decodeContent(ring)).toMatchObject({ kind: 'call', call: { action: 'ring', key } });
  const keyless = encodeContent({ v: CONTENT_VERSION, kind: 'call', call: { callId, action: 'ring', timestamp: 1 } });
  expect(() => decodeContent(keyless)).toThrow();
  const bogus = encodeContent({ v: CONTENT_VERSION, kind: 'call', call: { callId, action: 'explode', timestamp: 1 } } as never);
  expect(() => decodeContent(bogus)).toThrow();
});

it('moves call history forward only', () => {
  expect(nextStatus('ringing', 'accept', false, 'out')).toBe('answered');
  expect(nextStatus('ringing', 'decline', false, 'out')).toBe('declined');
  expect(nextStatus('ringing', 'cancel', false, 'in')).toBe('missed');
  expect(nextStatus('answered', 'end', false, 'in')).toBe('ended');
  expect(nextStatus('ended', 'accept', false, 'in')).toBe('ended');
  expect(nextStatus('ringing', 'busy', false, 'out')).toBe('busy');
});

describe('group call rekey', () => {
  it('converges on the newest key, ties broken by the smaller key', () => {
    expect(supersedes(undefined, { key: 'b', generation: 0 })).toBe(true);
    expect(supersedes({ key: 'b', generation: 1 }, { key: 'z', generation: 2 })).toBe(true);
    expect(supersedes({ key: 'b', generation: 2 }, { key: 'a', generation: 1 })).toBe(false);
    expect(supersedes({ key: 'b', generation: 2 }, { key: 'a', generation: 2 })).toBe(true);
    expect(supersedes({ key: 'a', generation: 2 }, { key: 'b', generation: 2 })).toBe(false);
    expect(supersedes({ key: 'a', generation: 2 }, { key: 'a', generation: 2 })).toBe(false);
  });
  it('picks one leader regardless of order', () => {
    expect(rekeyLeader(['c:1', 'a:2', 'b:1'])).toBe('a:2');
    expect(rekeyLeader(['b:1', 'c:1', 'a:2'])).toBe('a:2');
    expect(rekeyLeader([])).toBeUndefined();
  });
});

it('validates rekey messages', () => {
  const key = newMediaKey();
  const ok = encodeContent({ v: CONTENT_VERSION, kind: 'call', call: { callId, action: 'rekey', key, generation: 3, timestamp: 1 } });
  expect(decodeContent(ok)).toMatchObject({ call: { action: 'rekey', generation: 3 } });
  for (const call of [{ callId, action: 'rekey', key, timestamp: 1 }, { callId, action: 'rekey', generation: 1, timestamp: 1 },
    { callId, action: 'rekey', key, generation: 0, timestamp: 1 }, { callId, action: 'rekey', key, generation: -1, timestamp: 1 }]) {
    expect(() => decodeContent(encodeContent({ v: CONTENT_VERSION, kind: 'call', call } as never))).toThrow();
  }
});
