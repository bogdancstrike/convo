import { linksIn } from '../../lib/links';
import { ExternalLink } from '../components/ExternalLink';
export { linksIn } from '../../lib/links';
import { useMemo, useState } from 'react';
import { isAudio, isInlineImage, isVideo } from '../../core/attachments';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage } from '../../core/model';
import { AttachmentView } from '../components/AttachmentView';
import { Icon } from '../components/Icon';
import { useMessages } from '../hooks';
import { useI18n } from '../i18n/i18n';

export type SharedTab = 'media' | 'links' | 'docs';

/** Device-only shared content gallery, newest first and grouped by month. */
export function SharedContent({ client, conversationId, tab, onTab, onBack }: {
  client: EnclaveClient; conversationId: string; tab: SharedTab; onTab: (tab: SharedTab) => void; onBack: () => void;
}) {
  const { t, locale, date } = useI18n();
  const messages = useMessages(client, conversationId, Number.MAX_SAFE_INTEGER);
  const [limit, setLimit] = useState(60);
  const grouped = useMemo(() => {
    const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    const groups = new Map<string, ChatMessage[]>();
    for (const m of [...messages].reverse()) {
      if (m.deleted || m.unsupported || m.undecryptable) continue;
      const has = tab === 'links' ? linksIn(m.body ?? '').length > 0 : m.attachments?.some((a) =>
        tab === 'media' ? isInlineImage(a) || isVideo(a) || isAudio(a) : !isInlineImage(a) && !isVideo(a) && !isAudio(a));
      if (!has) continue;
      const label = month.format(m.sentAt);
      groups.set(label, [...(groups.get(label) ?? []), m]);
    }
    return [...groups];
  }, [messages, tab, locale]);
  let seen = 0;
  const total = grouped.reduce((n, [, m]) => n + m.length, 0);
  return <aside className="drawer shared-content" data-testid="shared-content" aria-label={t('shared.title')}>
    <header className="panel-header sub">
      <button className="icon-btn" onClick={onBack} aria-label={t('thread.back')} data-testid="shared-back"><Icon name="back" /></button>
      <h2>{t('shared.title')}</h2>
    </header>
    <div className="shared-tabs" role="tablist" aria-label={t('shared.title')}>
      {(['media', 'links', 'docs'] as const).map((key) => <button key={key} role="tab" id={`tab-${key}`} aria-controls="shared-panel" aria-selected={tab === key}
        onClick={() => { setLimit(60); onTab(key); }} data-testid={`shared-${key}`}>{t(`shared.${key}`)}</button>)}
    </div>
    <div className="panel-body shared-body" id="shared-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {!total && <div className="empty"><Icon name={tab === 'media' ? 'image' : 'file'} size={40} /><p>{t(`shared.empty.${tab}`)}</p></div>}
      {grouped.map(([month, items]) => {
        const visible = items.slice(0, Math.max(0, limit - seen)); seen += items.length;
        return visible.length ? <section key={month} className="shared-month"><h3>{month}</h3>
          <div className={tab === 'media' ? 'media-grid' : 'shared-items'}>
            {visible.map((m) => <div className="shared-item" key={`${m.authorId}/${m.id}`} title={date(m.sentAt)}>
              {tab === 'links' ? linksIn(m.body ?? '').map((url) => <ExternalLink key={url} href={url} className="shared-link"><Icon name="next" size={20} /><span>{url}</span></ExternalLink>) :
                m.attachments?.filter((a) => tab === 'media' ? isInlineImage(a) || isVideo(a) || isAudio(a) : !isInlineImage(a) && !isVideo(a) && !isAudio(a)).map((a) => <AttachmentView key={a.attachmentId} client={client} pointer={a} authorId={m.authorId} />)}
            </div>)}
          </div>
        </section> : null;
      })}
      {total > limit && <button className="btn" onClick={() => setLimit((n) => n + 60)}>{t('shared.more')}</button>}
    </div>
  </aside>;
}
