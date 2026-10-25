import { useCalls } from '../calls/CallProvider';
import { TimerNotice } from './TimerNotice';
import { PinnedBanner } from './PinnedBanner';
import { MAX_SELECTION, SelectionBar } from './SelectionBar';
import { conversationMenu } from './conversationMenu';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionState } from '../../api/socket';
import type { EnclaveClient } from '../../core/client';
import { MAX_ATTACHMENTS } from '../../crypto/content';
import { type ChatMessage, type Conversation } from '../../core/model';
import { LastSeen } from '../components/LastSeen';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Popover';
import { useGroupRecord, useMessages, useTyping, useSettings } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { fold } from './ChatListPanel';
import { Composer, type ComposerMode } from './Composer';
import { ForwardDialog } from './ForwardDialog';
import { MessageBubble, MessageInfoDialog, messageAnchor } from './MessageBubble';
import { ReportDialog } from './ReportDialog';
import { TopicBar } from './Topics';



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
  initialSearch,
  onBack,
  onInfo,
  onClose,
  onOpenConversation,
}: {
  client: EnclaveClient;
  conversation: Conversation;
  connection: ConnectionState;
  openPicker?: 'document' | null;
  initialSearch?: string;
  onBack: () => void;
  onInfo: () => void;
  onClose: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const { t } = useI18n();
  const settings = useSettings(client);
  const messages = useMessages(client, conversation.id);
  const typing = useTyping(client, conversation.id);
  const record = useGroupRecord(client, conversation.kind === 'group' ? conversation.id : null);
  const [memberNames, setMemberNames] = useState('');
  const [mode, setMode] = useState<ComposerMode>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  // Batch selection (FEAT-02): up to MAX_SELECTION messages for copy/forward/star/delete-for-me.
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [reporting, setReporting] = useState(false);
  const [batchForward, setBatchForward] = useState<ChatMessage[] | null>(null);
  const keyOf = (m: ChatMessage) => `${m.authorId}/${m.id}`;
  const [info, setInfo] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const title = conversation.kind === 'note' ? t('chats.noteToSelf') : conversation.title;
  const { start: startCall, call: activeCall } = useCalls();
  // Calls: direct chats and groups you are in; not Note to self or broadcast channels.
  const callable = conversation.kind !== 'note' && !conversation.left && !conversation.adminOnly && !conversation.blocked;
  const group = conversation.kind === 'group';
  const myRole = record?.members.find((m) => m.accountId === client.accountId)?.role;
  const readOnly = record?.needsJoin || conversation.adminOnly && (!record || myRole === 'member');
  // Group topics (specs §30.4): the selected topic filters messages and receives new ones.
  const [topic, setTopic] = useState<string | null>(null);
  const isGroupAdmin = myRole === 'owner' || myRole === 'admin';
  const currentTopic = conversation.topics?.find((x) => x.id === topic);
  const topicClosed = !!currentTopic?.closed && !isGroupAdmin;
  const addFiles = (added: File[]) => setFiles((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));

  useEffect(() => {
    void client.setActiveConversation(conversation.id);
    setMode(null);
    setFiles([]);
    setSearch(initialSearch ?? null);
    stickToBottom.current = true;
    return () => void client.setActiveConversation(null);
  }, [client, conversation.id, initialSearch]);

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
    const inTopic = conversation.topics?.length ? messages.filter((m) => (m.topic ?? null) === topic || (!!m.notice && topic === null)) : messages;
    return q ? inTopic.filter((m) => m.body && fold(m.body).includes(q)) : inTopic;
  }, [messages, search, topic, conversation.topics]);

  // First-unread navigation (FEAT-03): the unread count when the chat opened (Thread is keyed by
  // chat) marks where the "N unread messages" divider goes; the view starts there, not at the end.
  const [unreadAtOpen] = useState(conversation.unread);
  // Computed once from the history present at open; later arrivals must not move the divider.
  const anchor = useRef<string | null>(null);
  if (!anchor.current && unreadAtOpen && messages.length) {
    const incoming = messages.filter((m) => m.direction === 'in' && !m.notice);
    const first = incoming[Math.max(0, incoming.length - unreadAtOpen)];
    anchor.current = first ? `${first.authorId}/${first.id}` : null;
  }
  const firstUnread = anchor.current;
  const positioned = useRef(false);
  // Device-local reading position (specs §30.8): restored when the chat opens without new unread
  // messages; "Back to where you were" after jumping to the latest message.
  const [savedAnchor, setSavedAnchor] = useState<{ key: string; offset: number } | null | undefined>(undefined);
  const [anchorGone, setAnchorGone] = useState(false);
  const [returnTo, setReturnTo] = useState<{ key: string; offset: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { void client.readingAnchor(conversation.id).then((a) => setSavedAnchor(a ?? null)).catch(() => setSavedAnchor(null)); }, [client, conversation.id]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const topAnchor = (): { key: string; offset: number } | null => {
    const list = listRef.current; if (!list) return null;
    const top = list.getBoundingClientRect().top;
    for (const row of list.querySelectorAll<HTMLElement>('[data-testid="message"][data-key]')) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > top + 4) return { key: row.dataset.key!, offset: Math.round(rect.top - top) };
    }
    return null;
  };
  const scrollToAnchor = (anchorValue: { key: string; offset: number }): boolean => {
    const list = listRef.current;
    const [author, id] = anchorValue.key.split('/');
    const row = list && author && id ? list.querySelector<HTMLElement>(`#${messageAnchor(author, id)}`) : null;
    if (!list || !row) return false;
    stickToBottom.current = false; setAtBottom(false);
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - anchorValue.offset;
    return true;
  };
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const seen = useRef(shown.length);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || search) return;
    const grew = shown.length - seen.current;
    seen.current = shown.length;
    if (!positioned.current && firstUnread) {
      const divider = list.querySelector<HTMLElement>('[data-testid="unread-divider"]');
      if (divider) { positioned.current = true; stickToBottom.current = false; setAtBottom(false); divider.scrollIntoView({ block: 'start' }); return; }
    }
    if (!positioned.current && !firstUnread && savedAnchor !== undefined && shown.length) {
      positioned.current = true;
      if (savedAnchor && !scrollToAnchor(savedAnchor)) setAnchorGone(true); // expired/deleted: stay at the latest
      if (savedAnchor) return;
    }
    if (grew > 0 && !stickToBottom.current) setNewBelow((n) => n + grew);
    if (stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [shown, typing, search, firstUnread, savedAnchor]); // eslint-disable-line react-hooks/exhaustive-deps
  const jumpToLatest = () => {
    const list = listRef.current; if (!list) return;
    setReturnTo(topAnchor());
    stickToBottom.current = true; setAtBottom(true); setNewBelow(0);
    list.scrollTo({ top: list.scrollHeight, behavior: client.settings.animations ? 'smooth' : 'auto' });
  };

  const authorName = (m: ChatMessage) => (m.authorId === client.accountId ? t('chats.you') : group ? '' : title);

  const subtitle = typing
    ? t('header.typing')
    : group
      ? memberNames
      : conversation.kind === 'direct'
        ? '' // name + last seen only; handle and phone are in contact info
        : t('thread.noteHint');

  const menu = [{ label: t('select.start'), icon: 'check' as const, onSelect: () => setSelection(new Set()), testId: 'menu-select' },
    ...conversationMenu(client, conversation, t, onInfo, () => setSearch(''), onClose),
    ...(conversation.kind !== 'note' ? [{ label: t('report.title'), icon: 'alert' as const, onSelect: () => setReporting(true), testId: 'menu-report' }] : [])];
  const chosen = selection ? messages.filter((m) => selection.has(keyOf(m))).sort((a, b) => a.sort - b.sort) : [];

  const renderBubble = (m: ChatMessage, i: number, newDay: boolean) => {
    const prev = shown[i - 1];
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
              selection={selection ? { selected: selection.has(keyOf(m)), toggle: () => setSelection((s) => {
                const next = new Set(s); if (next.has(keyOf(m))) next.delete(keyOf(m)); else if (next.size < MAX_SELECTION) next.add(keyOf(m)); return next;
              }) } : undefined}
              actions={{
                onReply: (target) => setMode({ kind: 'reply', target }),
                onEdit: (target) => setMode({ kind: 'edit', target }),
                onForward: setForwarding,
                onInfo: setInfo,
              }}
            />
    );
  };

  return (
    <section
      data-wallpaper={conversation.wallpaper ?? settings.wallpaper}
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
      {reporting && <ReportDialog client={client} conversation={conversation} messages={messages} onClose={() => setReporting(false)} />}
      <header className="thread-header">
        <button className="icon-btn back-button" onClick={onBack} aria-label={t('thread.back')}>
          <Icon name="back" />
        </button>
        <Avatar id={conversation.id} name={title} size={40} group={group} />
        <button className="who" onClick={onInfo} data-testid="thread-info">
          <h2 data-testid="thread-title">{title}</h2>
          {subtitle && <span className={`sub${typing ? ' typing-sub' : ''}`}>{subtitle}</span>}
          {!typing && conversation.kind === 'direct' && <LastSeen client={client} accountId={conversation.id} />}
        </button>
        {conversation.kind === 'direct' && (
          <button className="icon-btn" onClick={onInfo} aria-label={t('thread.verify')} title={t('thread.verify')} data-testid="verify">
            <Icon name="shield" />
          </button>
        )}
        {callable && (
          <>
            <button className="icon-btn" disabled={!!activeCall} onClick={() => startCall(conversation.id, true)} aria-label={t('calls.videoCall')} title={t('calls.videoCall')} data-testid="start-video-call">
              <Icon name="video" />
            </button>
            <button className="icon-btn" disabled={!!activeCall} onClick={() => startCall(conversation.id, false)} aria-label={t('calls.voiceCall')} title={t('calls.voiceCall')} data-testid="start-voice-call">
              <Icon name="calls" />
            </button>
          </>
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
      {group && !conversation.adminOnly && !conversation.left && <TopicBar client={client} conversation={conversation} selected={topic} onSelect={setTopic} isAdmin={isGroupAdmin} />}
      <PinnedBanner client={client} conversation={conversation} />
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
          setAtBottom(stickToBottom.current);
          if (stickToBottom.current) setNewBelow(0);
          if (!search && positioned.current !== false) {
            clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => void client.setReadingAnchor(conversation.id, stickToBottom.current ? null : topAnchor()), 400);
          }
        }}
      >
        <div className="e2ee-banner">
          <Icon name="lock" size={13} /> {conversation.kind === 'note' ? t('thread.noteHint') : t('home.encrypted')}
        </div>
        {shown.map((m, i) => {
          const prev = shown[i - 1];
          const newDay = !prev || new Date(prev.sort).toDateString() !== new Date(m.sort).toDateString();
          const divider = !search && firstUnread === `${m.authorId}/${m.id}` ? <div className="unread-divider" data-testid="unread-divider" key="unread-divider">{unreadAtOpen === 1 ? t('thread.unreadDividerOne') : t('thread.unreadDivider', { count: unreadAtOpen })}</div> : null;
          if (divider) return [divider, m.notice ? <TimerNotice key={`${m.authorId}/${m.id}`} client={client} message={m} showDay={newDay} /> : renderBubble(m, i, newDay)];
          if (m.notice) return <TimerNotice key={`${m.authorId}/${m.id}`} client={client} message={m} showDay={newDay} />;
          return renderBubble(m, i, newDay);
        })}
      </div>
      {anchorGone && <p className="anchor-note" role="status" data-testid="anchor-gone">{t('thread.anchorGone')}<button className="icon-btn" onClick={() => setAnchorGone(false)} aria-label={t('info.close')}><Icon name="close" size={14} /></button></p>}
      {returnTo && atBottom && !search && (
        <button className="btn return-position" onClick={() => { if (!scrollToAnchor(returnTo)) setAnchorGone(true); setReturnTo(null); }} data-testid="return-position">
          <Icon name="back" size={16} /> {t('thread.returnPosition')}</button>
      )}
      {!atBottom && !search && (
        <button className="jump-latest" onClick={jumpToLatest} aria-label={t('thread.jumpLatest')} data-testid="jump-latest">
          <Icon name="chevronDown" size={20} />{newBelow > 0 && <span className="badge" data-testid="jump-latest-count">{newBelow}</span>}
        </button>
      )}
      {conversation.request && !conversation.blocked && (
        <div className="request-banner" role="region" aria-label={t('request.title')} data-testid="request-banner">
          <p>{t('request.body', { name: title })}</p>
          <div className="request-actions">
            <button className="btn" onClick={() => { if (window.confirm(t('block.confirm', { name: title }))) void client.setBlocked(conversation.id, true); }} data-testid="request-block">{t('block.block')}</button>
            <button className="btn btn-primary" onClick={() => void client.acceptRequest(conversation.id)} data-testid="request-accept">{t('request.accept')}</button>
          </div>
        </div>
      )}
      {conversation.blocked && (
        <div className="channel-read-only" role="status" data-testid="blocked-banner"><Icon name="lock" size={16} />{t('block.banner', { name: title })}
          <button className="btn" onClick={() => void client.setBlocked(conversation.id, false)} data-testid="unblock">{t('block.unblock')}</button></div>
      )}
      {topicClosed && <div className="channel-read-only" role="status" data-testid="topic-closed"><Icon name="lock" size={16} />{t('topics.closedNotice')}</div>}
      {!conversation.left && !readOnly && !conversation.blocked && !selection && !topicClosed && (
        <Composer
          key={conversation.id}
          topic={topic ?? undefined}
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
      {selection && (
        <SelectionBar client={client} messages={chosen} onCancel={() => setSelection(null)} onForward={() => setBatchForward(chosen)} />
      )}
      {batchForward && (
        <ForwardDialog client={client} messages={batchForward} onClose={() => setBatchForward(null)}
          onDone={(c) => { setBatchForward(null); setSelection(null); onOpenConversation(c.id); }} />
      )}
      {readOnly && !conversation.left && <div className="channel-read-only" role="status"><Icon name="lock" size={16} />{t(record?.needsJoin ? 'group.rejoin' : 'channel.readOnly')}</div>}
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
      {info && <MessageInfoDialog client={client} message={messages.find((m) => m.authorId === info.authorId && m.id === info.id) ?? info} onClose={() => setInfo(null)} />}
    </section>
  );
}
