import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReservationResponse } from './types';
import { enrollmentTranscript } from '../core/enrollment';
import { fromBase64Url, fromUtf8 } from '../lib/bytes';
import { canonicalRequest } from './http';

/** Shared Java/TypeScript vectors (contracts/vectors). The server runs the same assertions. */
const vectors = JSON.parse(readFileSync(resolve(__dirname, '../../../../contracts/vectors/device-auth-v1.json'), 'utf8'));

async function verify(spki: string, data: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('spki', fromBase64Url(spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromBase64Url(signature), new TextEncoder().encode(data));
}

describe('contract vectors: device-auth-v1', () => {
  it('builds the canonical device request string', async () => {
    const r = vectors.deviceRequest;
    const canonical = await canonicalRequest(r.method, r.pathAndQuery, fromBase64Url(r.body), r.deviceAddress, r.requestId, r.expiresAtMillis);
    expect(canonical).toBe(r.canonical);
    expect(await verify(vectors.signingKeySpki, canonical, r.signature)).toBe(true);
  });

  it('builds the canonical enrollment transcript', async () => {
    const e = vectors.enrollment;
    const reservation: ReservationResponse = {
      reservationId: e.reservationId,
      accountId: e.accountId,
      deviceId: e.deviceId,
      challenge: e.challenge,
      deploymentId: e.deploymentId,
      expiresAt: '',
    };
    const transcript = fromUtf8(await enrollmentTranscript(reservation, e.identityKey, e.registrationId, vectors.signingKeySpki));
    expect(transcript).toBe(e.canonical);
    expect(await verify(vectors.signingKeySpki, transcript, e.signature)).toBe(true);
  });
});
