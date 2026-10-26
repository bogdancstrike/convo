import { describe, expect, it } from 'vitest';
import { EnclaveApi } from './enclaveApi';
import type { HttpClient } from './http';

/** One recorded HTTP call made through the facade. */
interface Call { auth: 'signed' | 'bearer'; method: string; path: string; body?: unknown }

function recorder() {
  const calls: Call[] = [];
  const http = {
    signed: async (method: string, path: string, _device: unknown, body?: unknown) => { calls.push({ auth: 'signed', method, path, body }); return {}; },
    bearer: async (method: string, path: string, _token: string, body?: unknown) => { calls.push({ auth: 'bearer', method, path, body }); return {}; },
  } as unknown as HttpClient;
  const api = new EnclaveApi(http);
  api.useDevice({ accountId: 'acc', deviceId: 1, key: { sign: async () => new Uint8Array(64) } } as never);
  return { api, calls };
}

/** Hostile identifiers: path parameters must stay inside their segment. */
const HOSTILE = '../x/y?z=1#f';

/** Plausible arguments for any facade method (strings get the hostile identifier). */
function argsFor(fn: (...a: unknown[]) => unknown): unknown[] {
  return Array.from({ length: Math.max(fn.length, 4) }, (_, i) => (i === 0 ? HOSTILE : i === 1 ? HOSTILE : i === 2 ? 3 : []));
}

const methods = Object.getOwnPropertyNames(EnclaveApi.prototype).filter((m) => m !== 'constructor' && m !== 'useDevice' && m !== 'signed');

describe('EnclaveApi facade', () => {
  it('exposes the whole REST surface', () => {
    expect(methods.length).toBeGreaterThan(70);
  });

  it.each(methods)('%s makes exactly one well-formed request', async (name) => {
    const { api, calls } = recorder();
    const fn = (api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!;
    await fn.apply(api, argsFor(fn)).catch(() => undefined);
    expect(calls.length).toBe(1);
    const [call] = calls;
    expect(['GET', 'POST', 'PUT', 'DELETE']).toContain(call!.method);
    expect(call!.path.startsWith('/v1/')).toBe(true);
    // An identifier can never add path segments, a query or a fragment of its own.
    expect(call!.path).not.toContain('../x/y');
    expect(call!.path).not.toContain('#f');
    if (call!.method === 'GET') expect(call!.body).toBeUndefined();
  });

  it('uses the Keycloak token only for enrollment, linking, provisioning and recovery', async () => {
    const { api, calls } = recorder();
    for (const name of methods) {
      const fn = (api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!;
      await fn.apply(api, argsFor(fn)).catch(() => undefined);
    }
    const bearer = calls.filter((c) => c.auth === 'bearer').map((c) => `${c.method} ${c.path.replace(/\/[^/]*%2F[^/]*$/, '/{id}')}`);
    for (const route of bearer) {
      expect(route).toMatch(/^(POST \/v1\/devices\/(reservations|primary|link|recover)|POST \/v1\/provisioning\/sessions|(GET|DELETE) \/v1\/provisioning\/sessions\/|GET \/v1\/recovery|POST \/v1\/recovery\/reservations)/);
    }
    expect(bearer.length).toBeGreaterThanOrEqual(8);
  });

  it('refuses device calls before device credentials are configured', async () => {
    const api = new EnclaveApi({ signed: async () => ({}), bearer: async () => ({}) } as unknown as HttpClient);
    await expect(api.me()).rejects.toThrow('device credentials not configured');
  });

  it.each([
    ['me', [], 'GET', '/v1/accounts/me'],
    ['devices', [], 'GET', '/v1/devices'],
    ['history', [42], 'GET', '/v1/history?after=42'],
    ['keyStatus', [], 'GET', '/v1/keys/status'],
    ['searchDirectory', ['ana pop'], 'GET', '/v1/directory/search?q=ana%20pop'],
    ['ktConsistency', [3, 9], 'GET', '/v1/kt/consistency?from=3&to=9'],
    ['ktAccount', ['acc-1', 5], 'GET', '/v1/kt/accounts/acc-1?since=5'],
    ['roster', ['acc-1'], 'GET', '/v1/accounts/acc-1/devices'],
    ['socketTicket', [], 'POST', '/v1/ws/tickets'],
    ['accountCredentials', [true], 'GET', '/v1/account/credentials?refresh=true'],
    ['accountCredentials', [false], 'GET', '/v1/account/credentials'],
    ['unlinkDevice', [3], 'DELETE', '/v1/devices/3'],
    ['group', ['AbC-_x'], 'GET', '/v1/groups/AbC-_x'],
    ['putHistory', ['e1', 'c'], 'PUT', '/v1/history/e1'],
  ] as const)('%s → %s %s', async (name, args, method, path) => {
    const { api, calls } = recorder();
    await (api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!(...args);
    expect(calls).toEqual([expect.objectContaining({ method, path })]);
  });

  it('encodes directory queries so they cannot add parameters', async () => {
    const { api, calls } = recorder();
    await api.searchDirectory('a&admin=true#x');
    expect(calls[0]!.path).toBe('/v1/directory/search?q=a%26admin%3Dtrue%23x');
  });
});
