import type { AccountDto } from '../../api/types';
import { useI18n } from '../i18n/i18n';

/**
 * "Guest" label for time-limited guest accounts (FR-EXT-01), with the expiry date as a tooltip.
 * Guests are organization-issued accounts; the label lets people judge what to share with them.
 */
export function GuestBadge({ account }: { account: Pick<AccountDto, 'guestUntil'> | undefined }) {
  const { t, date } = useI18n();
  if (!account?.guestUntil) return null;
  const until = Date.parse(account.guestUntil);
  return <span className="role-tag guest-tag" title={t('guest.until', { date: date(until) })} data-testid="guest-badge">{t('guest.label')}</span>;
}
