import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import type { DeploymentInfo } from '../config/deployment';

/**
 * Organization sign-in through the deployment's OIDC provider (Keycloak) using Authorization Code
 * + PKCE (specs §4.1). The access token is only used for enrollment/linking; day-to-day traffic is
 * authenticated with the device proof-of-possession key, so tokens live in `sessionStorage` and
 * are discarded after registration.
 */
export class OrganizationAuth {
  private readonly manager: UserManager;

  constructor(info: DeploymentInfo, origin: string = window.location.origin) {
    this.manager = new UserManager({
      authority: info.oidc.issuer,
      client_id: info.oidc.clientId,
      redirect_uri: `${origin}/`,
      post_logout_redirect_uri: `${origin}/`,
      response_type: 'code',
      scope: 'openid profile phone',
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: false,
      loadUserInfo: false,
    });
  }

  /** Redirects to the IdP. `prompt=login` forces fresh authentication (step-up for enrollment). */
  async signIn(options: { fresh?: boolean } = {}): Promise<void> {
    await this.manager.signinRedirect(options.fresh ? { prompt: 'login' } : undefined);
  }

  /** @returns true if the current URL is an OIDC redirect callback. */
  isCallback(url: URL = new URL(window.location.href)): boolean {
    return url.searchParams.has('code') && url.searchParams.has('state');
  }

  /** Completes the redirect callback and removes OIDC parameters from the address bar. */
  async completeSignIn(): Promise<void> {
    await this.manager.signinRedirectCallback();
    window.history.replaceState(null, '', '/');
  }

  /** @returns a non-expired access token, or null when the user must sign in again. */
  async accessToken(): Promise<string | null> {
    const user = await this.manager.getUser();
    if (!user || user.expired) return null;
    return user.access_token;
  }

  /** Forgets the local OIDC session (does not sign out of the IdP). */
  async forget(): Promise<void> {
    await this.manager.removeUser();
  }
}
