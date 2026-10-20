import type { EnclaveClient } from '../../core/client';
import { DISAPPEARING_TIMERS } from '../../core/disappearing';
import type { ChatMessage } from '../../core/model';
import { Icon } from '../components/Icon';
import { useAccountLabel } from '../hooks';
import { useI18n, type I18n } from '../i18n/i18n';

/** Human label for a disappearing timer ("24 hours", "7 days", "90 days", "Off"). */
export function timerLabel(seconds: number, t: I18n['t']): string {
  if (!seconds) return t('timer.off');
  if (seconds === DISAPPEARING_TIMERS[1]) return t('timer.24h');
  if (seconds === DISAPPEARING_TIMERS[2]) return t('timer.7d');
  if (seconds === DISAPPEARING_TIMERS[3]) return t('timer.90d');
  return t('timer.custom', { hours: Math.round(seconds / 3600) });
}

/** Centered system row: "{name} set disappearing messages to 7 days" / "turned them off". */
export function TimerNotice({ client, message, showDay }: { client: EnclaveClient; message: ChatMessage; showDay: boolean }) {
  const { t, date } = useI18n();
  const own = message.authorId === client.accountId;
  const name = useAccountLabel(client, own ? undefined : message.authorId);
  const who = own ? t('chats.you') : name || '…';
  const seconds = message.notice?.seconds ?? 0;
  return (
    <>
      {showDay && <div className="day-separator">{date(message.sort)}</div>}
      <div className="system-notice" role="status" data-testid="timer-notice">
        <Icon name="clock" size={14} />
        {seconds ? t('timer.noticeOn', { who, duration: timerLabel(seconds, t) }) : t('timer.noticeOff', { who })}
      </div>
    </>
  );
}
