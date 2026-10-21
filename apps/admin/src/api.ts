import { accessToken } from './auth';

/**
 * Admin API (`/v1/admin/**` on this origin, proxied to the Convo server). The server checks the
 * admin role and a scoped permission on every call; the console only hides what is not allowed.
 * Nothing here can read message content: no such API exists.
 */
export type Permission =
  | 'ACCOUNTS_READ' | 'DEVICES_READ' | 'DEVICE_REVOKE' | 'ACCOUNT_STATUS' | 'AUDIT_READ' | 'AUDIT_EXPORT' | 'AUDIT_CHECKPOINT'
  | 'HEALTH_READ' | 'PUSH_REDRIVE' | 'STATS_READ' | 'USERS_CREATE' | 'USERS_CREDENTIALS' | 'RECOVERY_RESET' | 'ROLES_MANAGE';

export interface Me { actor: string; roles: string[]; permissions: Permission[] }
export interface AccountSummary {
  accountId: string; username: string; displayName: string | null; status: 'active' | 'disabled'; activeDevices: number;
  createdAt: string; lastSeenDay: string | null;
}
export interface DeviceSummary { deviceId: number; platform: string; createdAt: string; lastSeenDay: string | null }
export interface AuditEntry { seq: number; at: string; actor: string; action: string; target: string; reason: string; hash: string }
export interface AuditVerification { valid: boolean; entries: number; head: string; firstBrokenSeq: number | null; checkpointsChecked: number; checkpointMismatchSeq: number | null }
export interface DayStats { day: string; items: number; activeAccounts: number; newAccounts: number; calls: number; videoCalls: number; groupCalls: number }
export interface Overview {
  directory: { accounts: number; disabled: number; devices: number; seenToday: number; seen7d: number; seen30d: number };
  groups: { groups: number; channels: number }; communities: number; days: DayStats[];
  activityTracking: boolean; retentionDays: number; accountManagement: boolean;
}
export type Level = 'high' | 'medium' | 'low' | 'none';
export interface UserActivity { account: AccountSummary; items: number; activeDays: number; lastActiveDay: string | null; level: Level }
export interface AccountActivity { summary: UserActivity; days: { day: string; items: number }[]; window: number }
export interface IdpUser {
  id: string; username: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; enabled: boolean;
  createdAt: string | null; requiredActions: string[]; credentialTypes: string[]; roles: string[]; sessions: number; lastAccess: string | null;
}
export interface SignInAccount { user: IdpUser; convoAccountId: string | null }
export interface Health { push: { pending: number; oldestPending: string; deadLetters: Record<string, number> } }

export class AdminError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly detail?: string) { super(detail ?? `request failed: ${status}`); this.name = 'AdminError'; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  if (!token) throw new AdminError(401);
  const response = await fetch(`/v1/admin${path}`, {
    method, cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { code?: string; detail?: string };
    throw new AdminError(response.status, problem.code, problem.detail);
  }
  return response.json() as Promise<T>;
}

const q = encodeURIComponent;
export const api = {
  me: () => call<Me>('GET', '/me'),
  overview: (days: number) => call<Overview>('GET', `/stats/overview?days=${days}`),
  usersByActivity: (order: 'active' | 'inactive', days: number, limit = 10) => call<UserActivity[]>('GET', `/stats/users?order=${order}&days=${days}&limit=${limit}`),
  accountActivity: (id: string, days: number) => call<AccountActivity>('GET', `/accounts/${id}/activity?days=${days}`),
  accounts: (search: string) => call<AccountSummary[]>('GET', `/accounts?q=${q(search)}&limit=200`),
  devices: (id: string) => call<DeviceSummary[]>('GET', `/accounts/${id}/devices`),
  setDisabled: (id: string, disabled: boolean, reason: string) => call<AuditEntry>('POST', `/accounts/${id}/${disabled ? 'disable' : 'enable'}`, { reason }),
  revokeDevice: (id: string, deviceId: number, reason: string) => call<AuditEntry>('POST', `/accounts/${id}/devices/${deviceId}/revoke`, { reason }),
  revokeRecovery: (id: string, reason: string) => call<{ revoked: boolean }>('POST', `/accounts/${id}/recovery/revoke`, { reason }),
  signInOf: (id: string) => call<SignInAccount>('GET', `/accounts/${id}/sign-in`),
  idpUsers: (search: string) => call<SignInAccount[]>('GET', `/idp/users?q=${q(search)}&limit=100`),
  idpUser: (id: string) => call<SignInAccount>('GET', `/idp/users/${id}`),
  createUser: (draft: { username: string; firstName: string; lastName: string; email: string; phone: string; requirePasskey: boolean; reason: string }) =>
    call<{ account: SignInAccount; temporaryPassword: string }>('POST', '/idp/users', draft),
  resetPassword: (id: string, reason: string) => call<{ temporaryPassword: string }>('POST', `/idp/users/${id}/reset-password`, { reason }),
  requireActions: (id: string, actions: string[], reason: string) => call<AuditEntry>('POST', `/idp/users/${id}/required-actions`, { actions, reason }),
  signOutEverywhere: (id: string, reason: string) => call<AuditEntry>('POST', `/idp/users/${id}/sign-out`, { reason }),
  setSignInEnabled: (id: string, enabled: boolean, reason: string) => call<AuditEntry>('POST', `/idp/users/${id}/enabled`, { enabled, reason }),
  setRole: (id: string, role: string, granted: boolean, reason: string) => call<AuditEntry>('POST', `/idp/users/${id}/roles`, { role, granted, reason }),
  audit: () => call<AuditEntry[]>('GET', '/audit?limit=500'),
  verify: () => call<AuditVerification>('GET', '/audit/verify'),
  checkpoint: () => call<AuditVerification>('POST', '/audit/checkpoint'),
  exportAudit: (reason: string) => call<unknown>('POST', '/audit/export', { reason }),
  health: () => call<Health>('GET', '/health'),
  redrive: (reason: string) => call<{ queued: number }>('POST', '/push/redrive', { reason }),
};

/** Human text for the server's error codes. */
export function errorText(e: unknown): string {
  if (e instanceof AdminError) {
    if (e.code === 'STEP_UP_REQUIRED') return 'This action needs a recent sign-in. Sign in again, then retry.';
    if (e.code === 'FORBIDDEN_ROLE') return 'Your admin role does not allow this.';
    if (e.code === 'CONFLICT') return 'A sign-in account with that username or email already exists.';
    if (e.code === 'UNAVAILABLE') return 'The sign-in service is unavailable or account management is not configured.';
    if (e.status === 401) return 'Your session ended. Sign in again.';
    if (e.detail) return e.detail;
  }
  return 'The request failed. Check your connection and try again.';
}
