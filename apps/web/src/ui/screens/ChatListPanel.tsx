import { Menu } from '../components/Popover';
import { conversationMenu } from './conversationMenu';
import { fold } from '../../core/search';
export { fold } from '../../core/search';
import { useMemo, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { isMuted, type Conversation } from '../../core/model';
import { isSnoozed } from '../../core/snooze';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useAccountLabel, useMessageSearch } from '../hooks';
import { useChatLocks } from '../chatLocks';
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
  onInfo,
  onSearch,
  onClose,
  channels = false,
}: {
  channels?: boolean;
  client: EnclaveClient;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onInfo: (id: string) => void;
  onSearch: (id: string, query: string) => void;
  onClose: (id: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showArchived, setShowArchived] = useState(false);
  const locks = useChatLocks();
  const [showLocked, setShowLocked] = useState(false);
  const lockedCount = conversations.filter((c) => locks.locked(c.id)).length;

  const matches = useMessageSearch(client, query);
  // Message search never reveals locked chats.
  const matched = useMemo(() => new Map([...matches].reverse().filter((m) => !locks.locked(m.conversationId)).map((m) => [m.conversationId, m])), [matches, locks]);
  const archivedCount = conversations.filter((c) => c.archived).length;
  const visible = useMemo(() => {
    const q = fold(query);
    return conversations.filter(
      (c) =>
        locks.locked(c.id) === showLocked &&
        (showLocked || (showArchived ? c.archived : !c.archived)) &&
        (!channels || c.adminOnly) &&
        (!q || fold(c.kind === 'note' ? t('chats.noteToSelf') : c.title).includes(q) || matched.has(c.id)) &&
        (filter !== 'unread' || c.unread > 0) &&
        (filter !== 'groups' || c.kind === 'group'),
    );
  }, [conversations, query, filter, showArchived, t, matched, channels, locks, showLocked]);

  return (
    <>
      <header className="panel-header">
        {showArchived && (
          <button className="icon-btn" onClick={() => setShowArchived(false)} aria-label={t('thread.back')}>
            <Icon name="back" />
          </button>
        )}
        <h2>{showArchived ? t('chats.archived') : t(channels ? 'nav.channels' : 'appName')}</h2>
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
            <button key={f} className="chip" aria-pressed={filter === f && !showLocked} onClick={() => { setFilter(f); setShowLocked(false); }} data-testid={`filter-${f}`}>
              {t(`chats.filter.${f}`)}
            </button>
          ))}
          {lockedCount > 0 && (
            <button className="chip" aria-pressed={showLocked} data-testid="filter-locked"
              onClick={() => { if (showLocked) setShowLocked(false); else void locks.verify().then((ok) => ok && setShowLocked(true)); }}>
              <Icon name="lock" size={14} /> {t('lock.list')}
            </button>
          )}
        </div>
      )}
      {locks.error && <p role="alert" className="failed panel-alert">{locks.error}</p>}
      <div className="panel-body">
        {!showArchived && !showLocked && archivedCount > 0 && (
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
              <p>{t(channels ? 'channel.empty' : 'chats.empty.body')}</p>
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
                <ChatRow client={client} conversation={c} active={c.id === activeId} onSelect={() => { if (showLocked) { locks.grant(c.id); setShowLocked(false); } if (matched.has(c.id)) onSearch(c.id, query); else onSelect(c.id); }}
                  excerpt={query ? matched.get(c.id)?.body : undefined}
                  onInfo={() => onInfo(c.id)} onSearch={() => onSearch(c.id, '')} onClose={() => onClose(c.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ChatRow({ client, conversation: c, active, onSelect, excerpt, onInfo, onSearch, onClose }: {
  client: EnclaveClient; conversation: Conversation; active: boolean; onSelect: () => void;
  excerpt?: string; onInfo: () => void; onSearch: () => void; onClose: () => void;
}) {
  const locks = useChatLocks();
  const { t, time, date } = useI18n();
  const author = useAccountLabel(client, c.kind === 'group' && !c.previewFromMe ? c.previewAuthor : undefined);
  const title = c.kind === 'note' ? t('chats.noteToSelf') : c.title;
  const today = new Date().toDateString() === new Date(c.lastActivity).toDateString();
  const prefix = c.draft ? null : c.previewFromMe ? `${t('chats.you')}: ` : author ? `${author.split(' ')[0]}: ` : '';
  return (
    <div className="chat-row">
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
              excerpt ?? `${prefix}${localizedPreview(c.preview ?? '', t)}`
            )}
          </span>
          <span className="row-icons">
            {isMuted(c) && <Icon name="mute" size={16} label={t('chats.mute')} />}
            {isSnoozed(c.snooze) && <span data-testid="snoozed" title={t('snooze.until', { when: new Date(c.snooze!.until).toLocaleString(), zone: c.snooze!.zone })}><Icon name="clock" size={16} label={t('snooze.active')} /></span>}
            {c.pinned && <Icon name="pin" size={16} label={t('chats.pinned')} />}
            {c.request && <span className="role-tag" data-testid="request-tag">{t('request.tag')}</span>}
            {c.unread > 0 && (
              <>{c.mentioned && <span className="chat-mention-badge" aria-label={t('mention.badge')} data-testid="mention-badge">@</span>}
              <span className="badge" aria-label={t('chats.unread', { count: c.unread })}>
                {c.unread}
              </span></>
            )}
          </span>
        </span>
      </span>
      <span />
    </button>
    <Menu label={t('header.more')} items={conversationMenu(client, c, t, onInfo, onSearch, onClose,
      { locked: locks.locked(c.id), available: locks.passkey === true, toggle: () => void locks.toggle(c.id) })}
      trigger={({ open, toggle }) => <button className="icon-btn chat-row-menu" onClick={toggle}
        aria-label={`${t('header.more')}: ${title}`} aria-expanded={open} aria-haspopup="menu" data-testid={`chat-menu-${c.title}`}>
        <Icon name="more" size={18} />
      </button>} />
    </div>
  );
}

/** Previews of media messages are generated in English by the shared core; show them localized. */
function localizedPreview(preview: string, t: ReturnType<typeof useI18n>['t']): string {
  if (preview === '📷 Photo') return `📷 ${t('attachment.photo')}`;
  if (preview === '🎤 Voice message') return `🎤 ${t('msg.voiceNote')}`;
  if (preview === '📎 File') return `📎 ${t('attachment.file')}`;
  return preview;
}
