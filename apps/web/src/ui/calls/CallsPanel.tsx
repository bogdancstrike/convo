import { useEffect, useState } from 'react';
import type { CallLogEntry } from '../../core/calls';
import type { EnclaveClient } from '../../core/client';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import { useCalls } from './CallProvider';

/**
 * Calls panel: this device's encrypted call history (never uploaded). Tap the call button of an
 * entry to call back with the same media type.
 */
export function CallsPanel({ client, onOpenChat }: { client: EnclaveClient; onOpenChat: (id: string) => void }) {
  const { t, date, time } = useI18n();
  const { start, call } = useCalls();
  const [entries, setEntries] = useState<CallLogEntry[]>([]);
  useEffect(() => {
    const load = () => void client.callLog().then(setEntries);
    load();
    return client.on('callLog', load);
  }, [client]);
  const conversations = new Map(client.conversations().map((c) => [c.id, c]));
  return (
    <>
      <header className="panel-header"><h2>{t('nav.calls')}</h2>
        {entries.length > 0 && <button className="btn btn-ghost" onClick={() => void client.clearCallLog()} data-testid="calls-clear">{t('calls.clear')}</button>}
      </header>
      <div className="panel-body">
        {entries.length === 0 ? (
          <div className="empty"><Icon name="calls" size={44} /><h3>{t('calls.emptyTitle')}</h3><p>{t('calls.emptyBody')}</p></div>
        ) : (
          <ul className="call-log" data-testid="call-log">
            {entries.map((e) => {
              const c = conversations.get(e.conversationId);
              const missed = e.direction === 'in' && (e.status === 'missed' || e.status === 'cancelled');
              const label = t(`calls.status.${e.status}` as 'calls.status.missed');
              return (
                <li key={e.callId} className="call-log-row" data-testid="call-log-entry" data-status={e.status}>
                  <button className="row" onClick={() => c && onOpenChat(c.id)}>
                    <Avatar id={e.conversationId} name={c?.title ?? '?'} size={44} group={c?.kind === 'group'} />
                    <span className="row-main">
                      <span className={`row-title${missed ? ' missed' : ''}`}>{c?.title ?? t('calls.unknown')}</span>
                      <span className="row-preview">
                        <Icon name={e.direction === 'in' ? 'callIn' : 'callOut'} size={14} /> {label} · {date(e.startedAt)} {time(e.startedAt)}
                      </span>
                    </span>
                  </button>
                  {c && !c.left && !c.adminOnly && (
                    <button className="icon-btn" disabled={!!call} onClick={() => start(c.id, e.video)} aria-label={t(e.video ? 'calls.videoCall' : 'calls.voiceCall')}>
                      <Icon name={e.video ? 'video' : 'calls'} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
