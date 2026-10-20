import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ConnectionState } from '../../api/socket';
import { EDIT_WINDOW_MS, type EnclaveClient } from '../../core/client';
import type { ChatMessage, Conversation } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { FormattedText } from '../components/FormattedText';
import { Icon } from '../components/Icon';
import { useMessages, useTyping } from '../hooks';
import { useI18n } from '../i18n/i18n';

/** Quick reaction set; full emoji picker is a later feature. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

type ComposerMode = { kind: 'reply'; target: ChatMessage } | { kind: 'edit'; target: ChatMessage } | null;

/**
 * Conversation view (UI.md §5.2–5.3): header, security notices, message list with day
 * separators, per-message actions (reply, react, edit, delete, copy) and the composer.
 */
export function Thread({
  client,
  conversation,
  connection,
  onBack,
  onVerify,
}: {
  client: EnclaveClient;
  conversation: Conversation;
  connection: ConnectionState;
  onBack: () => void;
  onVerify: () => void;
}) {
  const { t } = useI18n();
  const messages = useMessages(client, conversation.id);
  const typing = useTyping(client, conversation.id);
  const [mode, setMode] = useState<ComposerMode>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const title = conversation.kind === 'note' ? t('chats.noteToSelf') : conversation.title;

  useEffect(() => {
    void client.setActiveConversation(conversation.id);
    setMode(null);
    stickToBottom.current = true;
    return () => void client.setActiveConversation(null);
  }, [client, conversation.id]);

  useEffect(() => {
    if (conversation.unread > 0 && document.visibilityState === 'visible') void client.markRead(conversation.id);
  }, [client, conversation.id, conversation.unread]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages, typing]);

  const authorName = (m: ChatMessage) => (m.authorId === client.accountId ? client.device.username : conversation.title);

  return (
    <section className="thread" aria-label={title}>
      <header className="thread-header">
        <button className="btn btn-icon back-button" onClick={onBack} aria-label={t('thread.back')}>
          <Icon name="back" />
        </button>
        <Avatar id={conversation.id} name={title} size={36} />
        <h2 data-testid="thread-title">{title}</h2>
        {conversation.kind === 'direct' && (
          <button className="btn" onClick={onVerify}>
            <Icon name="shield" size={18} /> {t('thread.verify')}
          </button>
        )}
        <button className="btn btn-icon" onClick={() => void client.updateConversation(conversation.id, { pinned: !conversation.pinned })}>
          {conversation.pinned ? t('chats.unpin') : t('chats.pin')}
        </button>
        <button className="btn btn-icon" onClick={() => void client.updateConversation(conversation.id, { muted: !conversation.muted })}>
          {conversation.muted ? t('chats.unmute') : t('chats.mute')}
        </button>
        <button className="btn btn-icon" onClick={() => void client.updateConversation(conversation.id, { archived: !conversation.archived })}>
          {conversation.archived ? t('chats.unarchive') : t('chats.archive')}
        </button>
      </header>
      {connection !== 'online' && (
        <div className="connection-banner" role="status">
          {connection === 'connecting' ? t('conn.connecting') : t('conn.offline')}
        </div>
      )}
      {conversation.identityChangedAt && (
        <div className="notice" role="alert">
          <span>{t('identity.changed', { name: conversation.title })}</span>
          <button className="btn" onClick={onVerify}>
            {t('identity.review')}
          </button>
          <button className="btn" onClick={() => void client.acknowledgeIdentityChange(conversation.id)}>
            {t('identity.dismiss')}
          </button>
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
        {conversation.kind === 'note' && <p className="day-separator">{t('thread.noteHint')}</p>}
        {messages.map((m, i) => (
          <MessageView
            key={`${m.authorId}/${m.id}`}
            client={client}
            message={m}
            showDay={i === 0 || !sameDay(messages[i - 1]!.sort, m.sort)}
            quotedAuthor={m.quote ? (m.quote.authorId === client.accountId ? client.device.username : conversation.title) : ''}
            onReply={() => setMode({ kind: 'reply', target: m })}
            onEdit={() => setMode({ kind: 'edit', target: m })}
          />
        ))}
      </div>
      <div className="typing" aria-live="polite">
        {typing ? t('thread.typing', { name: conversation.title }) : ''}
      </div>
      <Composer
        key={conversation.id}
        client={client}
        conversation={conversation}
        mode={mode}
        authorName={mode ? authorName(mode.target) : ''}
        onDone={() => {
          setMode(null);
          stickToBottom.current = true;
        }}
      />
    </section>
  );
}

function MessageView({
  client,
  message: m,
  showDay,
  quotedAuthor,
  onReply,
  onEdit,
}: {
  client: EnclaveClient;
  message: ChatMessage;
  showDay: boolean;
  quotedAuthor: string;
  onReply: () => void;
  onEdit: () => void;
}) {
  const { t, time, date } = useI18n();
  const [reacting, setReacting] = useState(false);
  const own = m.authorId === client.accountId;
  const system = m.deleted || m.unsupported || m.undecryptable;
  const canEdit = own && !system && m.body !== undefined && Date.now() - m.sentAt < EDIT_WINDOW_MS;

  const remove = () => {
    if (window.confirm(t('thread.confirmDelete'))) void client.deleteForEveryone(m);
  };

  return (
    <>
      {showDay && <div className="day-separator">{date(m.sort)}</div>}
      <div className={`message-row ${m.direction}`} data-testid="message">
        {!system && (
          <div className="message-actions" data-open={reacting} role="toolbar" aria-label={t('thread.react')}>
            {reacting ? (
              QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  aria-label={`${t('thread.react')} ${emoji}`}
                  onClick={() => {
                    setReacting(false);
                    void client.react(m, emoji);
                  }}
                >
                  {emoji}
                </button>
              ))
            ) : (
              <>
                <button onClick={onReply}>{t('thread.reply')}</button>
                <button onClick={() => setReacting(true)} aria-label={t('thread.react')}>
                  🙂
                </button>
                {canEdit && <button onClick={onEdit}>{t('thread.edit')}</button>}
                <button onClick={() => void navigator.clipboard?.writeText(m.body ?? '')}>{t('thread.copy')}</button>
                {own && <button onClick={remove}>{t('thread.deleteForEveryone')}</button>}
                <button onClick={() => void client.deleteLocally(m)}>{t('thread.deleteForMe')}</button>
              </>
            )}
          </div>
        )}
        <div className={`bubble${system ? ' system' : ''}`} tabIndex={0}>
          {m.quote && !system && (
            <div className="quote">
              <strong>{quotedAuthor}</strong>
              <div>{m.quote.excerpt ?? t('thread.originalUnavailable')}</div>
            </div>
          )}
          {m.deleted ? (
            t('thread.deleted')
          ) : m.unsupported ? (
            t('thread.unsupported')
          ) : m.undecryptable ? (
            t('thread.undecryptable')
          ) : (
            <span data-testid="message-body">
              <FormattedText text={m.body ?? ''} />
            </span>
          )}
          {Object.keys(m.reactions).length > 0 && (
            <div className="reactions">
              {Object.entries(m.reactions).map(([emoji, ids]) => (
                <button
                  key={emoji}
                  className="reaction"
                  aria-pressed={ids.includes(client.accountId)}
                  onClick={() => void client.react(m, emoji)}
                  data-testid="reaction"
                >
                  {emoji} {ids.length}
                </button>
              ))}
            </div>
          )}
          <div className="meta">
            {m.editedAt && !m.deleted && <span>{t('thread.edited')}</span>}
            <span>{time(m.sentAt)}</span>
            {own && m.status && (
              <span className={m.status === 'failed' || m.status === 'blocked' ? 'failed' : ''} data-testid="message-status">
                {t(`status.${m.status}`)}
              </span>
            )}
            {own && (m.status === 'failed' || m.status === 'blocked') && (
              <button className="btn-icon reaction" onClick={() => void client.retry(m)}>
                {t('thread.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Composer({
  client,
  conversation,
  mode,
  authorName,
  onDone,
}: {
  client: EnclaveClient;
  conversation: Conversation;
  mode: ComposerMode;
  authorName: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(conversation.draft ?? '');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const typingSent = useRef(0);

  useEffect(() => {
    if (mode?.kind === 'edit') setText(mode.target.body ?? '');
    if (mode) textarea.current?.focus();
  }, [mode]);

  // Persist the draft (debounced) so it survives reloads (UI.md §1.1 "preserve work").
  useEffect(() => {
    if (mode?.kind === 'edit') return undefined;
    const timer = setTimeout(() => {
      if ((conversation.draft ?? '') !== text) void client.updateConversation(conversation.id, { draft: text || undefined });
    }, 400);
    return () => clearTimeout(timer);
  }, [client, conversation.id, conversation.draft, text, mode]);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    const current = mode;
    // Clear first: anything typed while the message is being persisted belongs to the next one.
    setText('');
    typingSent.current = 0;
    onDone();
    try {
      if (current?.kind === 'edit') {
        await client.edit(current.target, body);
      } else {
        const quote =
          current?.kind === 'reply'
            ? { messageId: current.target.id, authorId: current.target.authorId, excerpt: (current.target.body ?? '').slice(0, 120) }
            : undefined;
        await client.sendText(conversation.id, body, quote);
      }
      void client.sendTyping(conversation.id, 'stopped');
    } catch (error) {
      // Local persistence failed (e.g. storage full): give the text back instead of losing it.
      setText((typed) => (typed ? typed : body));
      console.warn('Could not queue message', error instanceof Error ? error.message : error);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition Enter never sends (UI.md §5.3).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && client.settings.enterToSend) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && mode) {
      onDone();
      if (mode.kind === 'edit') setText('');
    }
  };

  const onChange = (value: string) => {
    setText(value);
    if (value && Date.now() - typingSent.current > 5000) {
      typingSent.current = Date.now();
      void client.sendTyping(conversation.id, 'started');
    }
  };

  return (
    <div className="composer">
      {mode && (
        <div className="composer-context">
          <span>
            {mode.kind === 'reply' ? t('thread.replyingTo', { name: authorName }) : t('thread.editing')}
            {mode.kind === 'reply' && `: ${mode.target.body ?? ''}`}
          </span>
          <button
            className="btn btn-icon"
            onClick={() => {
              if (mode.kind === 'edit') setText('');
              onDone();
            }}
          >
            {t('thread.cancel')}
          </button>
        </div>
      )}
      <div className="composer-row">
        <label className="visually-hidden" htmlFor="composer">
          {t('thread.placeholder')}
        </label>
        <textarea
          id="composer"
          ref={textarea}
          rows={1}
          placeholder={t('thread.placeholder')}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          data-testid="composer"
        />
        <button className="btn btn-primary" onClick={() => void submit()} disabled={!text.trim()} data-testid="send">
          {mode?.kind === 'edit' ? t('thread.save') : t('thread.send')}
        </button>
      </div>
    </div>
  );
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
