import { useMemo, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { isMuted, type Conversation } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useAccountLabel } from '../hooks';
import { useI18n } from '../i18n/i18n';

type Filter = 'all' | 'unread' | 'groups';

/**
 * Chat list (UI.md §5.1): header with new-chat action, "search or start a new chat", filter chips
 * (All / Unread / Groups), pinned-first rows with avatar, time, last-message preview ("You:" /
 * sender in groups), unread badge, mute and pin indicators, and an Archived entry.
 */
export function ChatListPanel({
  client,
  conversations,
  activeId,
  onSelect,
  onNewChat,
}: {
  client: EnclaveClient;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showArchived, setShowArchived] = useState(false);

  const archivedCount = conversations.filter((c) => c.archived).length;
  const visible = useMemo(() => {
    const q = fold(query);
    return conversations.filter(
      (c) =>
        (showArchived ? c.archived : !c.archived) &&
        (!q || fold(c.kind === 'note' ? t('chats.noteToSelf') : c.title).includes(q)) &&
        (filter !== 'unread' || c.unread > 0) &&
        (filter !== 'groups' || c.kind === 'group'),
    );
  }, [conversations, query, filter, showArchived, t]);

  return (
    <>
      <header className="panel-header">
        {showArchived && (
          <button className="icon-btn" onClick={() => setShowArchived(false)} aria-label={t('thread.back')}>
            <Icon name="back" />
          </button>
        )}
        <h2>{showArchived ? t('chats.archived') : t('appName')}</h2>
        <button className="icon-btn" onClick={onNewChat} title={t('chats.new')} aria-label={t('chats.new')} data-testid="new-chat">
          <Icon name="newChat" />
        </button>
      </header>
      <div className="panel-search">
        <label className="search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder={t('chats.searchOrStart')}
            aria-label={t('chats.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {!showArchived && (
        <div className="chips" role="group" aria-label={t('chats.search')}>
          {(['all', 'unread', 'groups'] as const).map((f) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`filter-${f}`}>
              {t(`chats.filter.${f}`)}
            </button>
          ))}
        </div>
      )}
      <div className="panel-body">
        {!showArchived && archivedCount > 0 && (
          <button className="row action" onClick={() => setShowArchived(true)}>
            <span style={{ width: 48, display: 'grid', placeItems: 'center', color: 'var(--c-accent-text)' }}>
              <Icon name="archive" />
            </span>
            <span className="row-main">
              <span className="row-line">
                <span className="row-title">{t('chats.archived')}</span>
                <span className="row-time">{archivedCount}</span>
              </span>
            </span>
            <span />
          </button>
        )}
        {visible.length === 0 ? (
          conversations.length === 0 ? (
            <div className="empty">
              <h3>{t('chats.empty.title')}</h3>
              <p>{t('chats.empty.body')}</p>
              <button className="btn btn-primary" onClick={onNewChat}>
                {t('chats.new')}
              </button>
            </div>
          ) : (
            <p className="empty">{t('chats.noResults')}</p>
          )
        ) : (
          <ul className="list">
            {visible.map((c) => (
              <li key={c.id}>
                <ChatRow client={client} conversation={c} active={c.id === activeId} onSelect={() => onSelect(c.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ChatRow({ client, conversation: c, active, onSelect }: { client: EnclaveClient; conversation: Conversation; active: boolean; onSelect: () => void }) {
  const { t, time, date } = useI18n();
  const author = useAccountLabel(client, c.kind === 'group' && !c.previewFromMe ? c.previewAuthor : undefined);
  const title = c.kind === 'note' ? t('chats.noteToSelf') : c.title;
  const today = new Date().toDateString() === new Date(c.lastActivity).toDateString();
  const prefix = c.draft ? null : c.previewFromMe ? `${t('chats.you')}: ` : author ? `${author.split(' ')[0]}: ` : '';
  return (
    <button className="row" aria-current={active} onClick={onSelect} data-testid={`conversation-${c.title}`}>
      <Avatar id={c.id} name={title} group={c.kind === 'group'} />
      <span className="row-main">
        <span className="row-line">
          <span className="row-title">{title}</span>
          <span className={`row-time${c.unread > 0 ? ' unread' : ''}`}>{today ? time(c.lastActivity) : date(c.lastActivity)}</span>
        </span>
        <span className="row-line">
          <span className="row-preview">
            {c.draft ? (
              <>
                <strong style={{ color: 'var(--c-accent-text)' }}>✎</strong> {c.draft}
              </>
            ) : (
              `${prefix}${c.preview ?? ''}`
            )}
          </span>
          <span className="row-icons">
            {isMuted(c) && <Icon name="mute" size={16} label={t('chats.mute')} />}
            {c.pinned && <Icon name="pin" size={16} label={t('chats.pinned')} />}
            {c.unread > 0 && (
              <span className="badge" aria-label={t('chats.unread', { count: c.unread })}>
                {c.unread}
              </span>
            )}
          </span>
        </span>
      </span>
      <span />
    </button>
  );
}

/** Lower-case + strip combining marks (Romanian diacritics, UI.md §5.5). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}
