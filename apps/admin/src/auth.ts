import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

/**
 * Admin sign-in: OIDC code flow with PKCE against the Convo realm, served by Keycloak on this
 * console's own origin (`/auth`), client `convo-admin`. Tokens live in sessionStorage only (gone
 * when the tab closes); `prompt=login` forces a fresh sign-in, which also satisfies step-up.
 */
const users = new UserManager({
  authority: `${window.location.origin}/auth/realms/enclave`,
  client_id: 'convo-admin',
  redirect_uri: `${window.location.origin}/auth/convo/admin`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'openid profile',
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: false,
  loadUserInfo: false,
});

/** Completes the redirect if this is the callback; returns the signed-in admin's name or null. */
export async function session(): Promise<string | null> {
  const url = new URL(window.location.href);
  if (url.searchParams.has('code') && url.searchParams.has('state')) {
    await users.signinRedirectCallback();
    window.history.replaceState(null, '', '/#/overview');
  }
  const user = await users.getUser();
  return user && !user.expired ? (user.profile.preferred_username ?? user.profile.sub) : null;
}

export function signIn(): Promise<void> { return users.signinRedirect({ prompt: 'login' }); }

export async function signOut(): Promise<void> {
  const user = await users.getUser();
  await users.removeUser();
  if (user?.id_token) await users.signoutRedirect({ id_token_hint: user.id_token });
}

export async function accessToken(): Promise<string | null> {
  const user = await users.getUser();
  return user && !user.expired ? user.access_token : null;
}
