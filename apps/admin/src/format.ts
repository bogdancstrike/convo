import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { Level } from './api';

dayjs.extend(relativeTime);

export const fmtDay = (day: string | null | undefined) => (day ? dayjs(day).format('D MMM YYYY') : '—');
export const fmtTime = (iso: string | null | undefined) => (iso ? dayjs(iso).format('D MMM YYYY, HH:mm') : '—');
export const fmtAgo = (iso: string | null | undefined) => (iso ? dayjs(iso).fromNow() : 'never');
export const shortDay = (day: string) => dayjs(day).format('D MMM');
export const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Activity level labels and colours (status vocabulary). */
export const LEVEL: Record<Level, { label: string; color: string }> = {
  high: { label: 'Very active', color: 'green' },
  medium: { label: 'Active', color: 'blue' },
  low: { label: 'Occasional', color: 'gold' },
  none: { label: 'Inactive', color: 'default' },
};

/** Seconds from an ISO-8601 duration such as `PT1M30.5S` (the server's `Duration`). */
export function seconds(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(iso);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/** Display name of an account: IdP name, else handle. */
export const nameOf = (a: { displayName: string | null; username: string }) => a.displayName || a.username;

export const ACTION_LABELS: Record<string, string> = {
  UPDATE_PASSWORD: 'Change password', 'webauthn-register-passwordless': 'Set up a passkey', CONFIGURE_TOTP: 'Set up authenticator app',
  UPDATE_PROFILE: 'Update profile', VERIFY_EMAIL: 'Verify email',
};
export const CREDENTIAL_LABELS: Record<string, string> = { password: 'Password', 'webauthn-passwordless': 'Passkey', otp: 'Authenticator app', webauthn: 'Security key' };
export const ROLE_LABELS: Record<string, string> = {
  'convo-admin': 'Administrator (all)', 'convo-helpdesk': 'Helpdesk', 'convo-org-admin': 'Organization admin', 'convo-security': 'Security', 'convo-auditor': 'Auditor',
};
