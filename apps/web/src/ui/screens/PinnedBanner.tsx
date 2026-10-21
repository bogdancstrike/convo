import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage, Conversation } from '../../core/model';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import { messageAnchor } from './MessageBubble';

/**
 * Shared pins (FEAT-02): one pinned message at a time under the chat header. Clicking jumps to
 * it and advances to the next pin; admins (or anyone in direct chats) can unpin. Deleted or
 * expired targets are skipped, so a pin never resurrects removed content.
 */
export function PinnedBanner({ client, conversation }: { client: EnclaveClient; conversation: Conversation }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [index, setIndex] = useState(0);
  const [canPin, setCanPin] = useState(false);
  const pins = conversation.pinnedMessages ?? [];
  const key = pins.map((p) => `${p.authorId}/${p.id}`).join(',');
  useEffect(() => {
    let cancelled = false;
    const load = () => void Promise.all(pins.map((p) => client.message(conversation.id, p.authorId, p.id)))
      .then((list) => !cancelled && setMessages(list.filter((m): m is ChatMessage => !!m && !m.deleted)));
    load();
    const off = client.on('messages', (id) => id === conversation.id && load());
    return () => { cancelled = true; off(); };
  }, [client, conversation.id, key]); // eslint-disable-line react-hooks/exhaustive-deps -- key captures pins
  useEffect(() => { void client.canPin(conversation.id).then(setCanPin); }, [client, conversation.id]);
  if (!messages.length) return null;
  const current = messages[index % messages.length]!;
  const excerpt = current.body ?? (current.attachments?.length ? t('attachment.photo') : '');
  const jump = () => {
    document.getElementById(messageAnchor(current.authorId, current.id))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setIndex((i) => (i + 1) % messages.length);
  };
  return (
    <div className="pinned-banner" data-testid="pinned-banner">
      <button className="pinned-main" onClick={jump} aria-label={t('pin.jump')}>
        <Icon name="pin" size={16} />
        <span className="pinned-text">
          <strong>{messages.length > 1 ? t('pin.countOf', { n: (index % messages.length) + 1, total: messages.length }) : t('pin.title')}</strong>
          <span data-testid="pinned-excerpt">{excerpt}</span>
        </span>
      </button>
      {canPin && <button className="icon-btn" onClick={() => void client.setPinned(current, false)} aria-label={t('pin.unpin')} data-testid="unpin-banner"><Icon name="close" size={16} /></button>}
    </div>
  );
}
