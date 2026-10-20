import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { Conversation } from '../../core/model';
import { labelOf } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useAccount } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { ContactInfo } from './InfoDrawer';
import { ConversationActions, SharedPreview } from './ConversationDetails';

export function ContactDrawer({ client, accountId, onBack, onMessage, onPage, onGroup }: {
  client: EnclaveClient; accountId: string; onBack: () => void; onMessage: () => void; onPage: (page: string) => void; onGroup: (id: string) => void;
}) {
  const { t } = useI18n(); const account = useAccount(client, accountId); const [common, setCommon] = useState<Conversation[]>([]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(client.conversations().filter((c) => c.kind === 'group' && !c.left).map(async (c) => {
      const record = await client.groupRecord(c.id);
      return record?.members.some((m) => m.accountId === accountId) && record.members.some((m) => m.accountId === client.accountId) ? c : null;
    })).then((groups) => { if (!cancelled) setCommon(groups.filter((c): c is Conversation => Boolean(c))); });
    return () => { cancelled = true; };
  }, [client, accountId]);
  const existing = client.conversation(accountId);
  const view: Conversation = existing ?? { id: accountId, kind: accountId === client.accountId ? 'note' : 'direct', title: account ? labelOf(account) : '…', lastActivity: 0, pinned: false, muted: false, archived: false, unread: 0 };
  return <aside className="drawer" data-testid="participant-contact"><header className="panel-header sub"><button className="icon-btn" onClick={onBack} aria-label={t('thread.back')}><Icon name="back" /></button><h2>{t('info.title')}</h2></header><div className="panel-body">
    <ContactInfo client={client} conversation={view} />
    <div className="contact-message-action"><button className="btn btn-primary" onClick={onMessage} data-testid="contact-message"><Icon name="chats" size={18} />{t('info.message')}</button></div>
    <SharedPreview client={client} conversation={view} onOpen={() => onPage('media')} />
    {existing && <ConversationActions client={client} conversation={existing} onClose={onBack} onPage={onPage} />}
    <section className="drawer-section"><h4>{t('info.commonGroups', { count: common.length })}</h4>{common.map((group) => <button className="settings-row" key={group.id} onClick={() => onGroup(group.id)}><Avatar id={group.id} name={group.title} size={40} group /><span className="settings-row-text">{group.title}</span><Icon name="next" size={18} /></button>)}</section>
  </div></aside>;
}
