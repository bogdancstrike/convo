import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ConnectionState } from '../../api/socket';
import { EDIT_WINDOW_MS, type EnclaveClient } from '../../core/client';
import type { ChatMessage, Conversation } from '../../core/model';
import { AttachmentRejectedError, MAX_ATTACHMENT_BYTES } from '../../core/attachments';
import { MAX_ATTACHMENTS } from '../../crypto/content';
import { AttachmentView, formatBytes } from '../components/AttachmentView';
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
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const addFiles = (added: File[]) => setFiles((current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));
  const stickToBottom = useRef(true);
  const title = conversation.kind === 'note' ? t('chats.noteToSelf') : conversation.title;

  useEffect(() => {
    void client.setActiveConversation(conversation.id);
    setMode(null);
    setFiles([]);
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
        {conversation.kind === 'group' && (
          <button className="btn" onClick={onVerify} data-testid="group-info">
            <Icon name="group" size={18} /> {t('group.info')}
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
      {conversation.left && (
        <div className="notice" role="status">
          <span>{t('group.left')}</span>
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
            showAuthor={conversation.kind === 'group' && m.direction === 'in' && (i === 0 || messages[i - 1]!.authorId !== m.authorId)}
            onReply={() => setMode({ kind: 'reply', target: m })}
            onEdit={() => setMode({ kind: 'edit', target: m })}
          />
        ))}
      </div>
      <div className="typing" aria-live="polite">
        {typing ? t('thread.typing', { name: conversation.title }) : ''}
      </div>
      {!conversation.left && <Composer
        key={conversation.id}
        client={client}
        conversation={conversation}
        mode={mode}
        files={files}
        onAddFiles={addFiles}
        onRemoveFile={(index) => setFiles((current) => current.filter((_, i) => i !== index))}
        onClearFiles={() => setFiles([])}
        authorName={mode ? authorName(mode.target) : ''}
        onDone={() => {
          setMode(null);
          stickToBottom.current = true;
        }}
      />}
    </section>
  );
}

function MessageView({
  client,
  message: m,
  showDay,
  quotedAuthor,
  showAuthor,
  onReply,
  onEdit,
}: {
  client: EnclaveClient;
  message: ChatMessage;
  showDay: boolean;
  quotedAuthor: string;
  showAuthor: boolean;
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
          {showAuthor && <AuthorName client={client} accountId={m.authorId} />}
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
            <>
              {m.attachments?.map((a) => <AttachmentView key={a.attachmentId} client={client} pointer={a} />)}
              {m.body && (
                <span data-testid="message-body">
                  <FormattedText text={m.body} />
                </span>
              )}
            </>
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
  files,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
  authorName,
  onDone,
}: {
  client: EnclaveClient;
  conversation: Conversation;
  mode: ComposerMode;
  files: File[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onClearFiles: () => void;
  authorName: string;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState(conversation.draft ?? '');
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  const oversized = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);

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

  const sendFiles = async () => {
    const caption = text.trim();
    const selected = files;
    setError(null);
    setUpload({ done: 0, total: selected.length });
    try {
      await client.sendAttachments(conversation.id, selected, caption, (done) => setUpload({ done, total: selected.length }));
      setText('');
      onClearFiles();
      onDone();
    } catch (e) {
      setError(
        e instanceof AttachmentRejectedError
          ? t(e.reason === 'too-large' ? 'attachment.tooLarge' : 'attachment.unreadable', { name: e.fileName })
          : t('attachment.uploadFailed'),
      );
    } finally {
      setUpload(null);
    }
  };

  const submit = async () => {
    if (upload) return;
    if (files.length > 0 && mode?.kind !== 'edit') {
      if (!oversized) await sendFiles();
      return;
    }
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
      {files.length > 0 && (
        <ul className="pending-files" aria-label={t('thread.attach')}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className={f.size > MAX_ATTACHMENT_BYTES ? 'failed' : ''} data-testid="pending-file">
              <span>
                {f.name} · {formatBytes(f.size, locale)}
              </span>
              <button className="btn-icon" onClick={() => onRemoveFile(i)} aria-label={t('thread.removeFile', { name: f.name })} disabled={!!upload}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {oversized && <div role="alert" className="failed">{t('attachment.tooLarge', { name: oversized.name })}</div>}
      {upload && <div role="status">{t('thread.uploading', { done: upload.done, total: upload.total })}</div>}
      {error && <div role="alert" className="failed">{error}</div>}
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
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          data-testid="file-input"
          onChange={(e) => {
            onAddFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <button
          className="btn btn-icon"
          onClick={() => fileInput.current?.click()}
          aria-label={t('thread.attach')}
          title={t('thread.attach')}
          disabled={mode?.kind === 'edit' || !!upload}
        >
          📎
        </button>
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
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length > 0) {
              e.preventDefault();
              onAddFiles(pasted);
            }
          }}
          data-testid="composer"
        />
        <button
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={!!upload || (!text.trim() && files.length === 0) || !!oversized}
          data-testid="send"
        >
          {mode?.kind === 'edit' ? t('thread.save') : t('thread.send')}
        </button>
      </div>
    </div>
  );
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Sender handle above incoming group messages. */
function AuthorName({ client, accountId }: { client: EnclaveClient; accountId: string }) {
  const [name, setName] = useState('');
  useEffect(() => {
    let cancelled = false;
    void client.displayName(accountId).then((n) => !cancelled && setName(n));
    return () => {
      cancelled = true;
    };
  }, [client, accountId]);
  return (
    <div className="author" data-testid="message-author">
      {name}
    </div>
  );
}
