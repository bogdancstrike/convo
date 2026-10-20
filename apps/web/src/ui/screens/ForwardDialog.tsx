import { useMemo, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage, Conversation } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useConversations } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { fold } from './ChatListPanel';

/**
 * Explicit single-destination forwarding (specs §30.8, UI.md §5.4c): pick one chat, review, send.
 * The copy is marked "Forwarded" and does not reference the original conversation.
 */
export function ForwardDialog({ client, message, messages, onClose, onDone }: { client: EnclaveClient; message?: ChatMessage; messages?: ChatMessage[]; onClose: () => void; onDone: (c: Conversation) => void }) {
  const { t } = useI18n();
  const conversations = useConversations(client);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const visible = useMemo(
    () => conversations.filter((c) => !c.left && fold(c.kind === 'note' ? t('chats.noteToSelf') : c.title).includes(fold(query))),
    [conversations, query, t],
  );

  const send = async (c: Conversation) => {
    setBusy(true); setFailed(false);
    try {
      for (const item of messages ?? (message ? [message] : [])) await client.forward(item, c.id);
      onDone(c);
    } catch { setFailed(true); } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog labelledBy="forward-title" onClose={onClose}>
      <h2 id="forward-title">{t('msg.forwardTo')}</h2>
      <label className="search">
        <Icon name="search" size={18} />
        <input autoFocus type="search" placeholder={t('chats.search')} aria-label={t('chats.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul className="list" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {visible.map((c) => (
          <li key={c.id}>
            <button className="row" disabled={busy} onClick={() => void send(c)} data-testid={`forward-to-${c.title}`}>
              <Avatar id={c.id} name={c.title} group={c.kind === 'group'} size={40} />
              <span className="row-main">
                <span className="row-title">{c.kind === 'note' ? t('chats.noteToSelf') : c.title}</span>
              </span>
              <Icon name="send" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {failed && <p role="alert" className="failed">{t('gallery.failed')}</p>}
      <button className="btn" disabled={busy} onClick={onClose}>{t('thread.cancel')}</button>
    </Dialog>
  );
}
