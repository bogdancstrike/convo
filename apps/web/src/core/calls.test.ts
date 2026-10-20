import { expect, it } from 'vitest';
import { CONTENT_VERSION, decodeContent, encodeContent } from '../crypto/content';
import { newMediaKey, nextStatus } from './calls';

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
