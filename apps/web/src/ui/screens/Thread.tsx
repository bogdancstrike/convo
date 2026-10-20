import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionState } from '../../api/socket';
import type { EnclaveClient } from '../../core/client';
import { MAX_ATTACHMENTS } from '../../crypto/content';
import { isMuted, type ChatMessage, type Conversation } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Menu, type MenuItem } from '../components/Popover';
import { useAccount, useGroupRecord, useMessages, useTyping } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { fold } from './ChatListPanel';
import { Composer, type ComposerMode } from './Composer';
import { ForwardDialog } from './ForwardDialog';
import { MessageBubble, MessageInfoDialog } from './MessageBubble';

const HOUR = 3_600_000;

/**
 * Conversation view (UI.md §5.2–5.3): header (avatar, name, members / handle, search, ⋮ menu),
 * security and connection notices, wallpaper message list with day separators and grouped
 * bubbles, drag & drop, and the composer.
 */
export function Thread({
  client,
  conversation,
  connection,
  openPicker,
  onBack,
  onInfo,
  onClose,
  onOpenConversation,
}: {
  client: EnclaveClient;
  conversation: Conversation;
  connection: ConnectionState;
  openPicker?: 'document' | null;
  onBack: () => void;
  onInfo: () => void;
  onClose: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const { t } = useI18n();
  const messages = useMessages(client, conversation.id);
  const typing = useTyping(client, conversation.id);
  const record = useGroupRecord(client, conversation.kind === 'group' ? conversation.id : null);
  const peer = useAccount(client, conversation.kind === 'direct' ? conversation.id : undefined);
  const [memberNames, setMemberNames] = useState('');
  const [mode, setMode] = useState<ComposerMode>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [info, setInfo] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const title = conversation.kind === 'note' ? t('chats.noteToSelf') : conversation.title;
  const group = conversation.kind === 'group';
  const addFiles = (added: File[]) => setFiles((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));

  useEffect(() => {
    void client.setActiveConversation(conversation.id);
    setMode(null);
    setFiles([]);
    setSearch(null);
    stickToBottom.current = true;
    return () => void client.setActiveConversation(null);
  }, [client, conversation.id]);

  useEffect(() => {
    if (conversation.unread > 0 && document.visibilityState === 'visible') void client.markRead(conversation.id);
  }, [client, conversation.id, conversation.unread]);

  // Group subtitle: "Ana, Bob, You".
  useEffect(() => {
    if (!record) return undefined;
    let cancelled = false;
    void Promise.all(
      record.members.map((m) => (m.accountId === client.accountId ? Promise.resolve(t('chats.you')) : client.displayName(m.accountId))),
    ).then((names) => !cancelled && setMemberNames(names.sort((a, b) => (a === t('chats.you') ? 1 : b === t('chats.you') ? -1 : a.localeCompare(b))).join(', ')));
    return () => {
      cancelled = true;
    };
  }, [client, record, t]);

  const shown = useMemo(() => {
    const q = search ? fold(search) : '';
    return q ? messages.filter((m) => m.body && fold(m.body).includes(q)) : messages;
  }, [messages, search]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current && !search) list.scrollTop = list.scrollHeight;
  }, [shown, typing, search]);

  const authorName = (m: ChatMessage) => (m.authorId === client.accountId ? t('chats.you') : group ? '' : title);

  const subtitle = typing
    ? t('header.typing')
    : group
      ? memberNames
      : conversation.kind === 'direct'
        ? peer
          ? [`@${peer.username}`, peer.phone].filter(Boolean).join(' · ')
          : t('header.clickForInfo')
        : t('thread.noteHint');

  const confirmThen = (question: string, run: () => Promise<void>) => () => {
    if (window.confirm(question)) void run();
  };

  const menu: MenuItem[] = [
    { label: group ? t('header.groupInfo') : t('header.contactInfo'), icon: 'info', onSelect: onInfo, testId: 'menu-info' },
    { label: t('header.search'), icon: 'search', onSelect: () => setSearch('') },
    isMuted(conversation)
      ? { label: t('header.unmuteNow'), icon: 'mute', onSelect: () => void client.setMute(conversation.id, null) }
      : {
          label: t('header.mute'),
          icon: 'mute',
          testId: 'menu-mute',
          children: [
            { label: t('header.mute8h'), onSelect: () => void client.setMute(conversation.id, Date.now() + 8 * HOUR) },
            { label: t('header.mute1w'), onSelect: () => void client.setMute(conversation.id, Date.now() + 7 * 24 * HOUR) },
            { label: t('header.muteAlways'), onSelect: () => void client.setMute(conversation.id, Infinity), testId: 'menu-mute-always' },
          ],
        },
    {
      label: conversation.pinned ? t('header.unpin') : t('header.pin'),
      icon: 'pin',
      onSelect: () => void client.updateConversation(conversation.id, { pinned: !conversation.pinned }),
    },
    {
      label: conversation.archived ? t('header.unarchive') : t('header.archive'),
      icon: 'archive',
      onSelect: () => void client.updateConversation(conversation.id, { archived: !conversation.archived }),
    },
    { label: t('header.close'), icon: 'close', onSelect: onClose },
    { label: t('header.clear'), icon: 'trash', onSelect: confirmThen(t('header.confirmClear'), () => client.clearConversation(conversation.id)) },
    {
      label: t('header.delete'),
      icon: 'trash',
      danger: true,
      onSelect: confirmThen(t('header.confirmDelete'), async () => {
        await client.deleteConversation(conversation.id);
        onClose();
      }),
    },
  ];

  return (
    <section
      className={`thread${dragging ? ' dragging' : ''}`}
      aria-label={title}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="thread-header">
        <button className="icon-btn back-button" onClick={onBack} aria-label={t('thread.back')}>
          <Icon name="back" />
        </button>
        <Avatar id={conversation.id} name={title} size={40} group={group} />
        <button className="who" onClick={onInfo} data-testid="thread-info">
          <h2 data-testid="thread-title">{title}</h2>
          <span className={`sub${typing ? ' typing-sub' : ''}`}>{subtitle}</span>
        </button>
        {conversation.kind === 'direct' && (
          <button className="icon-btn" onClick={onInfo} aria-label={t('thread.verify')} title={t('thread.verify')} data-testid="verify">
            <Icon name="shield" />
          </button>
        )}
        <button className="icon-btn" onClick={() => setSearch((s) => (s === null ? '' : null))} aria-label={t('header.search')} aria-pressed={search !== null}>
          <Icon name="search" />
        </button>
        <Menu
          label={t('header.more')}
          items={menu}
          trigger={({ open, toggle }) => (
            <button className="icon-btn" aria-label={t('header.more')} aria-expanded={open} onClick={toggle} data-testid="thread-menu">
              <Icon name="more" />
            </button>
          )}
        />
      </header>
      {search !== null && (
        <div className="thread-search">
          <label className="search">
            <Icon name="search" size={18} />
            <input autoFocus type="search" placeholder={t('header.searchPlaceholder')} aria-label={t('header.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {search && <span className="muted-text">{t('header.searchResults', { count: shown.length })}</span>}
          <button className="icon-btn" onClick={() => setSearch(null)} aria-label={t('thread.cancel')}>
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {connection !== 'online' && (
        <div className="connection-banner" role="status">
          {connection === 'connecting' ? t('conn.connecting') : t('conn.offline')}
        </div>
      )}
      {conversation.left && (
        <div className="notice" role="status">
          <span>{t('group.left')}</span>
        </div>
      )}
      {conversation.identityChangedAt && (
        <div className="notice" role="alert">
          <span>{t('identity.changed', { name: conversation.title })}</span>
          <button className="btn" onClick={onInfo}>{t('identity.review')}</button>
          <button className="btn btn-ghost" onClick={() => void client.acknowledgeIdentityChange(conversation.id)}>{t('identity.dismiss')}</button>
        </div>
      )}
      <div
        className="messages"
        ref={listRef}
        role="log"
        aria-live="polite"
        data-testid="message-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="e2ee-banner">
          <Icon name="lock" size={13} /> {conversation.kind === 'note' ? t('thread.noteHint') : t('home.encrypted')}
        </div>
        {shown.map((m, i) => {
          const prev = shown[i - 1];
          const newDay = !prev || new Date(prev.sort).toDateString() !== new Date(m.sort).toDateString();
          const first = newDay || !prev || prev.authorId !== m.authorId || m.sort - prev.sort > 10 * 60_000;
          return (
            <MessageBubble
              key={`${m.authorId}/${m.id}`}
              client={client}
              message={m}
              group={group}
              first={first}
              showDay={newDay}
              highlight={search ?? undefined}
              quotedAuthor={m.quote ? (m.quote.authorId === client.accountId ? t('chats.you') : group ? '' : title) : ''}
              actions={{
                onReply: (target) => setMode({ kind: 'reply', target }),
                onEdit: (target) => setMode({ kind: 'edit', target }),
                onForward: setForwarding,
                onInfo: setInfo,
              }}
            />
          );
        })}
      </div>
      {!conversation.left && (
        <Composer
          key={conversation.id}
          client={client}
          conversation={conversation}
          mode={mode}
          files={files}
          onAddFiles={addFiles}
          onRemoveFile={(index) => setFiles((current) => current.filter((_, i) => i !== index))}
          onClearFiles={() => setFiles([])}
          authorName={mode ? authorName(mode.target) : ''}
          openPicker={openPicker}
          onDone={() => {
            setMode(null);
            stickToBottom.current = true;
          }}
        />
      )}
      {forwarding && (
        <ForwardDialog
          client={client}
          message={forwarding}
          onClose={() => setForwarding(null)}
          onDone={(c) => {
            setForwarding(null);
            onOpenConversation(c.id);
          }}
        />
      )}
      {info && <MessageInfoDialog message={info} onClose={() => setInfo(null)} />}
    </section>
  );
}
