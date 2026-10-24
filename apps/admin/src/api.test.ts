import { beforeEach, expect, it, vi } from 'vitest';
const { accessToken } = vi.hoisted(() => ({ accessToken: vi.fn() }));
vi.mock('./auth', () => ({ accessToken }));
import { api, AdminError } from './api';
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
beforeEach(() => { vi.resetAllMocks(); accessToken.mockResolvedValue('valid'); });

it('refreshes once after a rejected token and retries with the replacement token', async () => {
  accessToken.mockResolvedValueOnce('old').mockResolvedValueOnce('new');
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(new Response('{"actor":"ana","roles":[],"permissions":[]}'));
  expect((await api.me()).actor).toBe('ana');
  expect(accessToken).toHaveBeenNthCalledWith(2, true);
  expect(fetchMock.mock.calls.map((c) => c[1].headers.Authorization)).toEqual(['Bearer old', 'Bearer new']);
});
it('does not loop when the renewed token is still refused', async () => {
  fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 401 })));
  await expect(api.me()).rejects.toBeInstanceOf(AdminError); expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('preserves permission denials without token refresh', async () => {
  fetchMock.mockResolvedValue(new Response('{"code":"FORBIDDEN_ROLE"}', { status: 403 }));
  await expect(api.me()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN_ROLE' }); expect(accessToken).toHaveBeenCalledTimes(1);
});
it('encodes audit filters and the pagination cursor for server-side search', async () => {
  fetchMock.mockResolvedValue(new Response('[]'));
  await api.audit({ user: 'idp-id,account-id', action: 'auth.login', q: 'Ana & Dan', before: 42 });
  const url = new URL(fetchMock.mock.calls[0]![0], 'https://admin.test');
  expect(url.searchParams.get('user')).toBe('idp-id,account-id'); expect(url.searchParams.get('q')).toBe('Ana & Dan'); expect(url.searchParams.get('before')).toBe('42');
});
