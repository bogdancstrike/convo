import { accessToken } from './auth';

/**
 * Admin API (`/v1/admin/**` on this origin, proxied to the Convo server). The server checks the
 * admin role and a scoped permission on every call; the console only hides what is not allowed.
 * Nothing here can read message content: no such API exists.
 */
export type Permission =
  | 'ACCOUNTS_READ' | 'DEVICES_READ' | 'DEVICE_REVOKE' | 'ACCOUNT_STATUS' | 'AUDIT_READ' | 'AUDIT_EXPORT' | 'AUDIT_CHECKPOINT'
  | 'HEALTH_READ' | 'PUSH_REDRIVE' | 'STATS_READ' | 'USERS_CREATE' | 'USERS_CREDENTIALS' | 'RECOVERY_RESET' | 'ROLES_MANAGE' | 'SESSIONS_READ' | 'SESSIONS_REVOKE' | 'ALERTS_READ' | 'ALERTS_MANAGE' | 'ALERT_RULES_MANAGE';

export interface Me { actor: string; roles: string[]; permissions: Permission[] }
export interface AccountSummary {
  accountId: string; username: string; displayName: string | null; status: 'active' | 'disabled'; activeDevices: number;
  createdAt: string; lastSeenDay: string | null;
}
export interface DeviceSummary { deviceId: number; platform: string; createdAt: string; lastSeenDay: string | null }
export interface AuditEntry { seq: number; at: string; actor: string; actorName?: string; action: string; target: string; targetName?: string; reason: string; hash: string }
export interface AuditFilters { before?: number; q?: string; action?: string; user?: string; from?: string; to?: string }
export interface AuditSource { configured: boolean; lastSuccess: string | null; error: string | null }
export interface AuditVerification { valid: boolean; entries: number; head: string; firstBrokenSeq: number | null; checkpointsChecked: number; checkpointMismatchSeq: number | null }
/** One day: activeAccounts = opened Convo or sent; senders = sent at least one item; web/androidUsers = people per platform. */
export interface DayStats { day: string; items: number; activeAccounts: number; senders: number; webUsers: number; androidUsers: number; newAccounts: number; calls: number; videoCalls: number; groupCalls: number }
export interface Overview {
  directory: { accounts: number; disabled: number; devices: number; seenToday: number; seen7d: number; seen30d: number };
  groups: { groups: number; channels: number }; communities: number; days: DayStats[];
  activityTracking: boolean; retentionDays?: number | null; accountManagement: boolean;
}
export type Level = 'high' | 'medium' | 'low' | 'none';
export interface UserActivity { account: AccountSummary; items: number; activeDays: number; lastActiveDay: string | null; level: Level }
export interface AccountDay { day: string; items: number; opened: boolean; web: boolean; android: boolean }
export interface AccountActivity { summary: UserActivity; days: AccountDay[]; window: number; from?: string; to?: string }
export interface IdpUser {
  id: string; username: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; enabled: boolean;
  createdAt: string | null; requiredActions: string[]; credentialTypes: string[]; roles: string[]; sessions: number; lastAccess: string | null;
}
export interface SignInAccount { user: IdpUser; convoAccountId: string | null }
export interface RoleHolder { id: string; username: string; firstName: string | null; lastName: string | null; phone: string | null; enabled: boolean }
export interface RoleView { role: string; permissions: Permission[]; holders: RoleHolder[] }
export interface Levels { high: number; medium: number; low: number; none: number; window: number }
export interface DateRange { from: string; to: string }
export interface Throughput { bucketMinutes?: number; from?: string; to?: string; minutes: { minute: string; items: number; calls: number; uploads: number }[]; recordingSince: string; capturedAt: string; enabled: boolean }
export interface TableQuery { q: string; sort: string; order: 'asc' | 'desc'; page: number; size: number; filters: Record<string, string> }
export interface TablePage<T> { rows: T[]; total: number; page: number; size: number; warnings: string[] }
export type ComponentStatus = 'UP' | 'DOWN' | 'DEGRADED' | 'DISABLED' | 'UNKNOWN';
export interface ComponentHealth { id: string; name: string; group: string; required: boolean; scope: string; status: ComponentStatus; detail: string; latencyMs: number; checkedAt: string }
export interface SystemHealth { status: ComponentStatus; checkedAt: string; cacheSeconds: number; components: ComponentHealth[] }
export interface Health { push: { pending: number; oldestPending: string; deadLetters: Record<string, number> } }

export interface LiveSession { id: string; userId: string; username: string; ipAddress: string | null; startedAt: string | null; lastAccess: string | null; clients: string[]; browser: string; operatingSystem: string; observedAt: string | null; current: boolean }
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export interface SecurityAlert { id: string; ruleId: string; severity: AlertSeverity; status: AlertStatus; title: string; subject: string; subjectName: string; detail: string; occurrences: number; firstSeq: number | null; lastSeq: number | null; firstSeen: string; lastSeen: string; createdAt: string; updatedAt: string }
export interface AlertHistory { id: number; at: string; actor: string; status: AlertStatus; reason: string }
export interface AlertDetail { alert: SecurityAlert; history: AlertHistory[] }
export interface AlertRule { id: string; enabled: boolean; severity: AlertSeverity; threshold: number; windowMinutes: number; notificationsEnabled: boolean; updatedAt: string; updatedBy: string }
export interface AlertSummary { open: number; acknowledged: number; critical: number; notifications: number; processedAt: string | null; error: string | null; recent: SecurityAlert[] }

export class AdminError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly detail?: string) { super(detail ?? `request failed: ${status}`); this.name = 'AdminError'; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let token = await accessToken();
  if (!token) throw new AdminError(401);
  const request = () => fetch(`/v1/admin${path}`, {
    method, cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let response = await request();
  if (response.status === 401) {
    token = await accessToken(true);
    if (token) response = await request();
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { code?: string; detail?: string };
    throw new AdminError(response.status, problem.code, problem.detail);
  }
  return response.json() as Promise<T>;
}

const q = encodeURIComponent;
const dateQuery = (range?: DateRange) => range ? `&from=${q(range.from)}&to=${q(range.to)}` : '';
export const api = {
  table: <T,>(resource: string, scope: Record<string, string>, query: TableQuery) => {
    const params = new URLSearchParams({ ...scope, q: query.q, sort: query.sort, order: query.order, page: String(query.page), size: String(query.size), ...Object.fromEntries(Object.entries(query.filters).map(([k, v]) => [`f_${k}`, v])) });
    return call<TablePage<T>>('GET', `/tables/${q(resource)}?${params}`);
  },
  endSession: (user: string, id: string, reason: string) => call<AuditEntry>('POST', `/idp/users/${q(user)}/sessions/${q(id)}/end`, { reason }),
  alertSummary: () => call<AlertSummary>('GET', '/alerts/summary'),
  alertDetail: (id: string) => call<AlertDetail>('GET', `/alerts/${q(id)}`),
  alertRules: () => call<AlertRule[]>('GET', '/alerts/rules'),
  alertStatus: (id: string, status: AlertStatus, reason: string) => call<AlertDetail>('POST', `/alerts/${q(id)}/status`, { status, reason }),
  updateAlertRule: (rule: AlertRule, reason: string) => call<AlertRule[]>('POST', `/alerts/rules/${q(rule.id)}`, { ...rule, reason }),
  me: () => call<Me>('GET', '/me'),
  throughput: (minutes: number, range?: DateRange) => call<Throughput>('GET', `/stats/throughput?minutes=${minutes}${dateQuery(range)}`),
  overview: (days: number, range?: DateRange) => call<Overview>('GET', `/stats/overview?days=${days}${dateQuery(range)}`),
  usersByActivity: (order: 'active' | 'inactive', days: number, limit = 10) => call<UserActivity[]>('GET', `/stats/users?order=${order}&days=${days}&limit=${limit}`),
  accountActivity: (id: string, days: number, range?: DateRange) => call<AccountActivity>('GET', `/accounts/${id}/activity?days=${days}${dateQuery(range)}`),
  accounts: (search: string) => call<AccountSummary[]>('GET', `/accounts?q=${q(search)}&limit=200`),
  account: (id: string) => call<AccountSummary>('GET', `/accounts/${q(id)}`),
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
  roles: () => call<RoleView[]>('GET', '/roles'),
  levels: (days: number, range?: DateRange) => call<Levels>('GET', `/stats/levels?days=${days}${dateQuery(range)}`),
  audit: (filters: AuditFilters = {}) => call<AuditEntry[]>('GET', `/audit?limit=100&${new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  auditSources: () => call<AuditSource>('GET', '/audit/sources'),
  verify: () => call<AuditVerification>('GET', '/audit/verify'),
  checkpoint: () => call<AuditVerification>('POST', '/audit/checkpoint'),
  exportAudit: (reason: string) => call<unknown>('POST', '/audit/export', { reason }),
  health: () => call<Health>('GET', '/health'),
  systemHealth: () => call<SystemHealth>('GET', '/health/system'),
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
