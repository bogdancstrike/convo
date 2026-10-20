import { useMemo, useState } from 'react';
import type { Conversation } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/**
 * Conversation list (UI.md §5.1): search, pinned section, archive toggle, unread badges.
 * Search folds diacritics so "stefan" finds "Ștefan".
 */
export function ChatList({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onNewGroup,
  onNoteToSelf,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onNewGroup: () => void;
  onNoteToSelf: () => void;
}) {
  const { t, time } = useI18n();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const visible = useMemo(() => {
    const q = fold(query);
    return conversations.filter((c) => (showArchived ? c.archived : !c.archived) && (!q || fold(c.title).includes(q)));
  }, [conversations, query, showArchived]);
  const pinned = visible.filter((c) => c.pinned);
  const others = visible.filter((c) => !c.pinned);
  const hasArchived = conversations.some((c) => c.archived);

  const row = (c: Conversation) => (
    <li key={c.id}>
      <button
        className="conversation"
        aria-current={c.id === activeId}
        onClick={() => onSelect(c.id)}
        data-testid={`conversation-${c.title}`}
      >
        <Avatar id={c.id} name={c.title} />
        <span style={{ minWidth: 0 }}>
          <span className="title" style={{ display: 'block' }}>
            {c.kind === 'note' ? t('chats.noteToSelf') : c.title}
          </span>
          <span className="preview" style={{ display: 'block' }}>
            {c.draft ? `✎ ${c.draft}` : (c.preview ?? '')}
          </span>
        </span>
        <span className="meta">
          <span>{time(c.lastActivity)}</span>
          {c.unread > 0 && (
            <span className="badge" aria-label={t('chats.unread', { count: c.unread })}>
              {c.unread}
            </span>
          )}
          {c.muted && <span aria-label={t('chats.mute')}>🔕</span>}
        </span>
      </button>
    </li>
  );

  return (
    <section className="list-pane" aria-label={t('nav.chats')}>
      <div className="list-header">
        <div className="list-header-row">
          <h2>{showArchived ? t('chats.archived') : t('nav.chats')}</h2>
          <button className="btn btn-icon" onClick={onNoteToSelf} title={t('chats.noteToSelf')} aria-label={t('chats.noteToSelf')}>
            <Icon name="note" />
          </button>
          <button className="btn btn-icon" onClick={onNewGroup} title={t('group.new')} aria-label={t('group.new')} data-testid="new-group">
            <Icon name="group" />
          </button>
          <button className="btn btn-icon" onClick={onNewChat} title={t('chats.new')} aria-label={t('chats.new')} data-testid="new-chat">
            <Icon name="plus" />
          </button>
        </div>
        <input
          className="input"
          type="search"
          placeholder={t('chats.search')}
          aria-label={t('chats.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {visible.length === 0 && !query && !showArchived ? (
        <div className="empty">
          <h3>{t('chats.empty.title')}</h3>
          <p>{t('chats.empty.body')}</p>
          <button className="btn btn-primary" onClick={onNewChat}>
            {t('chats.new')}
          </button>
          <button className="btn" onClick={onNoteToSelf}>
            {t('chats.noteToSelf')}
          </button>
        </div>
      ) : (
        <ul className="conversation-list">
          {pinned.length > 0 && <li className="section-label">{t('chats.pinned')}</li>}
          {pinned.map(row)}
          {pinned.length > 0 && others.length > 0 && <li className="section-label">{t('nav.chats')}</li>}
          {others.map(row)}
        </ul>
      )}
      {(hasArchived || showArchived) && (
        <button className="btn btn-icon" style={{ margin: 8 }} onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? t('chats.hideArchived') : t('chats.showArchived')}
        </button>
      )}
    </section>
  );
}

/** Lower-case + strip combining marks (Romanian diacritics, UI.md §5.5). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}
