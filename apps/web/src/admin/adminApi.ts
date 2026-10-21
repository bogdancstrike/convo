import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { loadDeploymentInfo } from '../config/deployment';

/**
 * Admin console data access (ADM-01). Signs in with the organization IdP (PKCE) and calls
 * `/v1/admin/**` with the bearer token; the server requires the admin realm role. No device keys,
 * no chat data: this page cannot read messages or join conversations.
 */
export interface AccountSummary { accountId: string; username: string; displayName: string | null; status: string; activeDevices: number }
export interface DeviceSummary { deviceId: number; platform: string; createdAt: string; lastSeenDay: string | null }
export interface AuditEntry { seq: number; at: string; actor: string; action: string; target: string; reason: string; hash: string }
export interface AuditVerification { valid: boolean; entries: number; head: string; firstBrokenSeq: number | null; checkpointsChecked: number; checkpointMismatchSeq: number | null }

export class AdminApi {
  private constructor(private readonly users: UserManager) {}

  static async create(): Promise<AdminApi> {
    const info = await loadDeploymentInfo();
    return new AdminApi(new UserManager({
      authority: info.oidc.issuer, client_id: info.oidc.clientId,
      redirect_uri: `${window.location.origin}/auth/convo/admin`, response_type: 'code', scope: 'openid profile',
      userStore: new WebStorageStateStore({ store: window.sessionStorage }), stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: false, loadUserInfo: false,
    }));
  }

  /** Completes the redirect if this is a callback; returns the signed-in admin's name or null. */
  async session(): Promise<string | null> {
    const url = new URL(window.location.href);
    if (url.searchParams.has('code') && url.searchParams.has('state')) {
      await this.users.signinRedirectCallback();
      window.history.replaceState(null, '', '/admin');
    }
    const user = await this.users.getUser();
    return user && !user.expired ? (user.profile.preferred_username ?? user.profile.sub) : null;
  }

  signIn(): Promise<void> { return this.users.signinRedirect({ prompt: 'login' }); }
  async signOut(): Promise<void> { await this.users.removeUser(); }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const user = await this.users.getUser();
    if (!user || user.expired) throw new AdminError(401);
    const response = await fetch(`/v1/admin${path}`, {
      method, headers: { Authorization: `Bearer ${user.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { code?: string };
      throw new AdminError(response.status, problem.code);
    }
    return response.json() as Promise<T>;
  }

  accounts(q: string) { return this.call<AccountSummary[]>('GET', `/accounts?q=${encodeURIComponent(q)}`); }
  devices(accountId: string) { return this.call<DeviceSummary[]>('GET', `/accounts/${accountId}/devices`); }
  setDisabled(accountId: string, disabled: boolean, reason: string) { return this.call<AuditEntry>('POST', `/accounts/${accountId}/${disabled ? 'disable' : 'enable'}`, { reason }); }
  revoke(accountId: string, deviceId: number, reason: string) { return this.call<AuditEntry>('POST', `/accounts/${accountId}/devices/${deviceId}/revoke`, { reason }); }
  audit() { return this.call<AuditEntry[]>('GET', '/audit?limit=200'); }
  verify() { return this.call<AuditVerification>('GET', '/audit/verify'); }
  checkpoint() { return this.call<AuditVerification>('POST', '/audit/checkpoint'); }
  /** Roles and permissions of the signed-in admin (the console shows only what they allow). */
  me() { return this.call<{ actor: string; roles: string[]; permissions: Permission[] }>('GET', '/me'); }
  /** Accountable export: recorded with its reason in the audit chain before the data is returned. */
  exportAudit(reason: string) { return this.call<unknown>('POST', '/audit/export', { reason }); }
}

export class AdminError extends Error {
  constructor(readonly status: number, readonly code?: string) { super(`admin request failed: ${status}`); this.name = 'AdminError'; }
}

/** Scoped admin permissions (server `AdminPermissions`). */
export type Permission = 'ACCOUNTS_READ' | 'DEVICES_READ' | 'DEVICE_REVOKE' | 'ACCOUNT_STATUS' | 'AUDIT_READ' | 'AUDIT_EXPORT' | 'AUDIT_CHECKPOINT';
