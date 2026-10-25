import type { AccountDto } from '../../api/types';
import { useI18n } from '../i18n/i18n';

/**
 * "Archive" / "Bot" label for integration accounts (FR-EXT-02, AC-INT-01/02), with what happens to
 * the content it receives as a tooltip. Shown wherever the account appears, like the guest label.
 */
export function IntegrationBadge({ account }: { account: Pick<AccountDto, 'integration'> | undefined }) {
  const { t } = useI18n();
  const integration = account?.integration;
  if (!integration) return null;
  return <span className="role-tag integration-tag" title={integration.retention} data-testid="integration-badge">{t(`integration.${integration.kind}`)}</span>;
}
