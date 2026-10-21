import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient, type DeviceCredentials } from './http';

const device: DeviceCredentials = { accountId: 'acc', deviceId: 1, key: { sign: async () => new Uint8Array(64) } as never };
const nonce = (n: number) => `n${String(n).padStart(31, '0')}`;

afterEach(() => vi.unstubAllGlobals());

describe('device proofs with server nonces (PRIV-02)', () => {
  it('fetches nonces when empty, then uses the one returned with each response', async () => {
    const calls: { url: string; nonce?: string }[] = [];
    let issued = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, nonce: headers['X-Enclave-Nonce'] });
      if (url.endsWith('/v1/device-nonces')) return new Response(JSON.stringify({ nonces: [nonce(++issued), nonce(++issued)] }), { status: 200 });
      return new Response('{}', { status: 200, headers: { 'X-Enclave-Next-Nonce': nonce(100 + calls.length) } });
    }));
    const http = new HttpClient();
    await http.signed('GET', '/v1/a', device);
    await http.signed('GET', '/v1/b', device);
    await http.signed('GET', '/v1/c', device);
    expect(calls.filter((c) => c.url.endsWith('/v1/device-nonces'))).toHaveLength(1);
    const used = calls.filter((c) => c.nonce).map((c) => c.nonce);
    expect(new Set(used).size).toBe(3); // never reused
  });

  it('retries once with fresh nonces after NONCE_INVALID', async () => {
    let rejected = false; let refills = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/v1/device-nonces')) { refills++; return new Response(JSON.stringify({ nonces: [nonce(refills)] }), { status: 200 }); }
      if (!rejected) { rejected = true; return new Response(JSON.stringify({ code: 'NONCE_INVALID' }), { status: 401 }); }
      return new Response('{"ok":true}', { status: 200 });
    }));
    await expect(new HttpClient().signed('GET', '/v1/x', device)).resolves.toEqual({ ok: true });
    expect(refills).toBe(2);
  });
});
