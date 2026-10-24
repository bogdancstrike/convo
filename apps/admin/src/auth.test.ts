import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ getUser: vi.fn(), signinSilent: vi.fn(), removeUser: vi.fn(), signoutRedirect: vi.fn(), stopSilentRenew: vi.fn(), events: { addAccessTokenExpiring: vi.fn() } }));
vi.mock('oidc-client-ts', () => ({ UserManager: class { constructor() { return mock; } }, WebStorageStateStore: class {} }));
vi.stubGlobal('window', { location: { origin: 'https://admin.test', href: 'https://admin.test/' }, sessionStorage: {}, history: { replaceState: vi.fn() } });
const { accessToken, session, signOut } = await import('./auth');
const user = (expires_in: number, refresh_token = 'refresh') => ({ access_token: 'old', refresh_token, expires_in, expired: expires_in <= 0, id_token: 'id', profile: { sub: 'subject', preferred_username: 'ana' } });

beforeEach(() => { vi.clearAllMocks(); mock.getUser.mockResolvedValue(user(120)); });
describe('admin token renewal', () => {
  it('keeps a valid access token', async () => { expect(await accessToken()).toBe('old'); expect(mock.signinSilent).not.toHaveBeenCalled(); });
  it('renews an expired session before deciding it has ended', async () => {
    mock.getUser.mockResolvedValue(user(-5)); mock.signinSilent.mockResolvedValue({ ...user(300), access_token: 'new' });
    expect(await session()).toBe('ana'); expect(mock.signinSilent).toHaveBeenCalledTimes(1);
  });
  it('coalesces concurrent refreshes near expiry', async () => {
    mock.getUser.mockResolvedValue(user(10)); mock.signinSilent.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ ...user(300), access_token: 'new' }), 5)));
    expect(await Promise.all([accessToken(), accessToken(), accessToken()])).toEqual(['new', 'new', 'new']);
    expect(mock.signinSilent).toHaveBeenCalledTimes(1);
  });
  it('does not attempt an iframe renewal without a refresh token', async () => {
    mock.getUser.mockResolvedValue(user(-5, '')); expect(await accessToken()).toBeNull(); expect(mock.signinSilent).not.toHaveBeenCalled();
  });
  it('ends a revoked refresh session but preserves a session on a network failure', async () => {
    mock.getUser.mockResolvedValue(user(-5)); mock.signinSilent.mockRejectedValue({ error: 'invalid_grant' });
    expect(await accessToken()).toBeNull(); expect(mock.removeUser).toHaveBeenCalledTimes(1);
    mock.removeUser.mockClear(); mock.signinSilent.mockRejectedValue(new TypeError('offline'));
    await expect(accessToken()).rejects.toThrow('offline'); expect(mock.removeUser).not.toHaveBeenCalled();
  });
  it('stops renewal before logout and clears the local user', async () => {
    await signOut(); expect(mock.stopSilentRenew).toHaveBeenCalled(); expect(mock.removeUser).toHaveBeenCalled(); expect(mock.signoutRedirect).toHaveBeenCalledWith({ id_token_hint: 'id' });
  });
});
