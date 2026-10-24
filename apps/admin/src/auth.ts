import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

/**
 * Admin sign-in: OIDC code flow with PKCE against the Convo realm, served by Keycloak on this
 * console's own origin (`/auth`), client `convo-admin`. Tokens live in sessionStorage only (gone
 * when the tab closes); `prompt=login` forces a fresh sign-in, which also satisfies step-up.
 */
const users = new UserManager({
  authority: `${window.location.origin}/auth/realms/enclave`,
  client_id: 'convo-admin',
  redirect_uri: `${window.location.origin}/auth/convo/admin`,
  post_logout_redirect_uri: `${window.location.origin}/auth/convo/admin`,
  response_type: 'code',
  scope: 'openid profile',
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  // Renewal is coordinated below so timers and concurrent API requests share one refresh.
  automaticSilentRenew: false,
  accessTokenExpiringNotificationTimeInSeconds: 60,
  loadUserInfo: false,
});

/** Completes the redirect if this is the callback; returns the signed-in admin's name or null. */
export async function session(): Promise<string | null> {
  const url = new URL(window.location.href);
  if (url.searchParams.has('code') && url.searchParams.has('state')) {
    await users.signinRedirectCallback();
    window.history.replaceState(null, '', '/#/overview');
  }
  const user = await currentUser();
  return user ? (user.profile.preferred_username ?? user.profile.sub) : null;
}

export function signIn(): Promise<void> { return users.signinRedirect({ prompt: 'login' }); }

export async function signOut(): Promise<void> {
  users.stopSilentRenew();
  if (renewing) await renewing.catch(() => undefined);
  const user = await users.getUser();
  await users.removeUser();
  if (user?.id_token) await users.signoutRedirect({ id_token_hint: user.id_token });
}

let renewing: Promise<User | null> | null = null;

async function currentUser(force = false): Promise<User | null> {
  const user = await users.getUser();
  if (!user) return null;
  if (!force && !user.expired && (user.expires_in ?? Infinity) > 60) return user;
  if (!user.refresh_token) return user.expired ? null : user;
  if (!renewing) {
    renewing = users.signinSilent().catch(async (error: unknown) => {
      const code = (error as { error?: string })?.error;
      if (code === 'invalid_grant' || code === 'login_required' || code === 'interaction_required') {
        await users.removeUser();
        return null;
      }
      // A temporary outage must not erase a renewable session.
      if (!user.expired && !force) return user;
      throw error;
    }).finally(() => { renewing = null; });
  }
  return renewing;
}

users.events.addAccessTokenExpiring(() => { void currentUser().catch(() => undefined); });

/** Refresh before expiry, including after a sleeping/background tab resumes. */
export async function accessToken(force = false): Promise<string | null> {
  return (await currentUser(force))?.access_token ?? null;
}
