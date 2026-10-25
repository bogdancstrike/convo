import type { EnclaveClient } from '../../core/client';
import type { Conversation } from '../../core/model';
import { SLOW_MODE_STEPS } from '../../core/memberPolicy';
import { useI18n, type I18n } from '../i18n/i18n';

/** "30 s", "5 min", "1 h" for slow-mode intervals. */
export function formatInterval(seconds: number, t: I18n['t']): string {
  if (seconds % 3600 === 0) return t('slow.hours', { count: String(seconds / 3600) });
  if (seconds % 60 === 0) return t('slow.minutes', { count: String(seconds / 60) });
  return t('slow.seconds', { count: String(seconds) });
}

/**
 * Group info: slow mode for owners/admins (specs §30.4). Per-member posting restrictions live in
 * each member's menu. Members see the active interval above the composer.
 */
export function SlowModeSection({ client, conversation, onError }: { client: EnclaveClient; conversation: Conversation; onError: (message: string) => void }) {
  const { t } = useI18n();
  const value = conversation.memberPolicy?.slowModeSeconds ?? 0;
  return (
    <section className="drawer-section" aria-labelledby="slow-mode-title" data-testid="slow-mode-section">
      <h4 id="slow-mode-title">{t('slow.title')}</h4>
      <label className="field">
        <span className="muted-text">{t('slow.hint')}</span>
        <select value={value} data-testid="slow-mode-select"
          onChange={(e) => void client.setMemberPolicy(conversation.id, { slowModeSeconds: Number(e.target.value) }).catch(() => onError(t('slow.failed')))}>
          {SLOW_MODE_STEPS.map((s) => <option key={s} value={s}>{s === 0 ? t('slow.off') : formatInterval(s, t)}</option>)}
        </select>
      </label>
    </section>
  );
}
