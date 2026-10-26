import { beforeEach, describe, expect, it, vi } from 'vitest';
const { accessToken } = vi.hoisted(() => ({ accessToken: vi.fn() }));
vi.mock('./auth', () => ({ accessToken }));
import { api, errorText, AdminError } from './api';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
beforeEach(() => {
  vi.resetAllMocks();
  accessToken.mockResolvedValue('tok');
  fetchMock.mockImplementation(() => Promise.resolve(new Response('{}')));
});

/** An identifier that would escape its path segment if it were not encoded. */
const HOSTILE = '../../policy?x=1#f';
type Method = (...args: unknown[]) => Promise<unknown>;
const methods = Object.keys(api) as (keyof typeof api)[];
const query = { q: 'a&b', sort: 'name', order: 'asc' as const, page: 2, size: 25, filters: { status: 'open&x' } };

/** Plausible arguments for any method: hostile strings, numbers, a table query and a policy. */
function argsFor(name: string): unknown[] {
  if (name === 'table') return ['people', { scope: 'all' }, query];
  if (name === 'resolveAlerts') return [{ scope: 'all' }, { q: '', filters: {} }, 'r'];
  if (name === 'updateAlertRule') return [{ id: HOSTILE, enabled: true }, 'r'];
  if (name === 'createUser' || name === 'createGuest') return [{ username: 'u', reason: 'r' }];
  if (name === 'publishPolicy') return [3, {}, 'r'];
  if (name === 'audit') return [{ q: HOSTILE }];
  return [HOSTILE, HOSTILE, HOSTILE, HOSTILE];
}

async function invoke(name: keyof typeof api) {
  await (api[name] as unknown as Method)(...argsFor(name));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init };
}

describe('admin API surface', () => {
  it('covers the console API', () => { expect(methods.length).toBeGreaterThan(45); });

  it.each(methods)('%s makes one bearer request under /v1/admin', async (name) => {
    const { url, init } = await invoke(name);
    expect(url.startsWith('/v1/admin/')).toBe(true);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.cache).toBe('no-store');
    expect(['GET', 'POST', 'PUT', 'DELETE']).toContain(init.method);
    if (init.method === 'GET') expect(init.body).toBeUndefined();
    else if (init.body) expect(init.headers['Content-Type']).toBe('application/json');
  });

  it.each(methods)('%s keeps identifiers inside their path segment', async (name) => {
    const { url } = await invoke(name);
    const path = url.split('?')[0]!;
    // Dots survive encoding; what must never appear is a dot-segment or an unencoded slash from the value.
    expect(path.split('/').filter((segment) => segment === '..' || segment === '.')).toEqual([]);
    expect(path).not.toContain('../');
    expect(url).not.toContain('#');
  });

  it('every state-changing call carries the audit reason', async () => {
    for (const name of methods) {
      fetchMock.mockClear();
      await (api[name] as unknown as Method)(...argsFor(name));
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      if (init.method === 'GET' || name === 'checkpoint') continue;
      expect(JSON.parse(String(init.body)), name).toHaveProperty('reason');
    }
  });

  it('table queries pass sort, paging and prefixed filters, encoded', async () => {
    const { url } = await invoke('table');
    const params = new URL(url, 'https://admin.test').searchParams;
    expect(url.startsWith('/v1/admin/tables/people?')).toBe(true);
    expect(params.get('q')).toBe('a&b'); expect(params.get('page')).toBe('2'); expect(params.get('size')).toBe('25');
    expect(params.get('f_status')).toBe('open&x'); expect(params.get('scope')).toBe('all');
  });

  it('date ranges are appended to statistics queries', async () => {
    await api.overview(30, { from: '2026-01-01', to: '2026-01-31' });
    const params = new URL(fetchMock.mock.calls[0]![0] as string, 'https://admin.test').searchParams;
    expect(params.get('days')).toBe('30'); expect(params.get('from')).toBe('2026-01-01'); expect(params.get('to')).toBe('2026-01-31');
  });

  it('removing an integration clears its retention', async () => {
    await api.setIntegration('acc', null, '30 days', 'r');
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ kind: null, retention: null, reason: 'r' });
  });

  it('enable and disable go to separate endpoints', async () => {
    await api.setDisabled('acc', true, 'r'); await api.setDisabled('acc', false, 'r');
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/v1/admin/accounts/acc/disable', '/v1/admin/accounts/acc/enable']);
  });

  it('empty audit filters are left out', async () => {
    await api.audit({ q: '', action: undefined, user: 'u1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/v1/admin/audit?limit=100&user=u1');
  });

  it('without a token nothing is sent', async () => {
    accessToken.mockResolvedValue(null);
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a problem body without JSON still yields an AdminError', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({ status: 502, code: undefined });
  });
});

describe('errorText', () => {
  it.each([
    [new AdminError(403, 'STEP_UP_REQUIRED'), 'This action needs a recent sign-in. Sign in again, then retry.'],
    [new AdminError(403, 'FORBIDDEN_ROLE'), 'Your admin role does not allow this.'],
    [new AdminError(409, 'CONFLICT'), 'A sign-in account with that username or email already exists.'],
    [new AdminError(503, 'UNAVAILABLE'), 'The sign-in service is unavailable or account management is not configured.'],
    [new AdminError(401), 'Your session ended. Sign in again.'],
    [new AdminError(422, 'POLICY_VIOLATION', 'Retention is too long.'), 'Retention is too long.'],
    [new AdminError(500), 'The request failed. Check your connection and try again.'],
    [new Error('network'), 'The request failed. Check your connection and try again.'],
    ['string', 'The request failed. Check your connection and try again.'],
    [null, 'The request failed. Check your connection and try again.'],
  ])('%s', (error, text) => { expect(errorText(error)).toBe(text); });
});
