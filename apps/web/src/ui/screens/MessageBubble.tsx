import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react-dom';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { EDIT_WINDOW_MS, type EnclaveClient } from '../../core/client';
import type { ChatMessage, MessageStatus } from '../../core/model';
import { AttachmentView } from '../components/AttachmentView';
import { Avatar } from '../components/Avatar';
import { Dialog } from '../components/Dialog';
import { EmojiPicker } from '../components/EmojiPicker';
import { FormattedText } from '../components/FormattedText';
import { Icon } from '../components/Icon';
import { useAccountLabel } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { nameColorIndex } from '../theme/tokens';

/** Quick reactions shown at the top of the message menu. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const LONG_PRESS_MS = 500;

export interface MessageActions {
  onReply: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onForward: (m: ChatMessage) => void;
  onInfo: (m: ChatMessage) => void;
}

/**
 * One message (UI.md §5.2): tailed bubble, optional sender name/avatar in groups, quote, forwarded
 * label, attachments, formatted body, reactions and an inline meta line (edited · time · ticks).
 * Hover reveals a chevron; click it, right-click or long-press to open the message menu.
 */
export function MessageBubble({
  client,
  message: m,
  group,
  first,
  showDay,
  highlight,
  quotedAuthor,
  actions,
}: {
  client: EnclaveClient;
  message: ChatMessage;
  group: boolean;
  first: boolean;
  showDay: boolean;
  highlight?: string;
  quotedAuthor: string;
  actions: MessageActions;
}) {
  const { t, time, date } = useI18n();
  const [menu, setMenu] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const own = m.authorId === client.accountId;
  const system = m.deleted || m.unsupported || m.undecryptable;
  const author = useAccountLabel(client, group && !own && first ? m.authorId : undefined);

  const startPress = () => {
    pressTimer.current = setTimeout(() => setMenu(true), LONG_PRESS_MS);
  };
  const endPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  return (
    <>
      {showDay && <div className="day-separator">{dayLabel(m.sort, t('chats.today'), t('chats.yesterday'), date)}</div>}
      <div className={`message-row ${m.direction}${first ? ' first' : ''}${group && !own ? ' grouped' : ''}`} data-testid="message">
        {group && !own && <span className="msg-avatar">{first && <Avatar id={m.authorId} name={author || '?'} size={28} />}</span>}
        <div
          ref={bubbleRef}
          className={`bubble${system ? ' system' : ''}${first ? ' tail' : ''}`}
          tabIndex={0}
          onContextMenu={(e) => {
            if (system) return;
            e.preventDefault();
            setMenu(true);
          }}
          onTouchStart={system ? undefined : startPress}
          onTouchEnd={endPress}
          onTouchMove={endPress}
          onKeyDown={(e) => {
            if (!system && e.target === e.currentTarget && (e.key === 'Enter' || e.key === 'ContextMenu')) {
              e.preventDefault();
              setMenu(true);
            }
          }}
        >
          {!system && (
            <button className="bubble-chevron" aria-label={t('msg.menu')} aria-haspopup="menu" onClick={() => setMenu(true)} data-testid="message-menu">
              <Icon name="chevronDown" size={18} />
            </button>
          )}
          {group && !own && first && author && (
            <div className="author" style={{ color: `var(--c-name-${nameColorIndex(m.authorId)})` }} data-testid="message-author">
              {author}
            </div>
          )}
          {m.forwarded && !system && (
            <div className="forwarded">
              <Icon name="next" size={14} /> {t('msg.forwarded')}
            </div>
          )}
          {m.quote && !system && (
            <div className="quote">
              <strong>{quotedAuthor}</strong>
              <div>{m.quote.excerpt ?? t('thread.originalUnavailable')}</div>
            </div>
          )}
          {m.deleted ? (
            <span>⊘ {t('thread.deleted')}</span>
          ) : m.unsupported ? (
            t('thread.unsupported')
          ) : m.undecryptable ? (
            t('thread.undecryptable')
          ) : (
            <>
              {m.attachments?.map((a) => <AttachmentView key={a.attachmentId} client={client} pointer={a} />)}
              {m.body && (
                <span data-testid="message-body">
                  <FormattedText text={m.body} highlight={highlight} />
                </span>
              )}
            </>
          )}
          <span className="meta">
            {m.starred && <Icon name="pin" size={12} label={t('msg.starred')} />}
            {m.editedAt && !m.deleted && <span>{t('thread.edited')}</span>}
            <span>{time(m.sentAt)}</span>
            {own && m.status && <StatusTicks status={m.status} />}
          </span>
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
          {own && (m.status === 'failed' || m.status === 'blocked') && (
            <button className="btn btn-ghost retry" onClick={() => void client.retry(m)}>
              {t('thread.retry')}
            </button>
          )}
        </div>
        {menu && <MessageMenu client={client} message={m} anchor={bubbleRef} onClose={() => setMenu(false)} actions={actions} />}
      </div>
    </>
  );
}

/** Delivery state as ticks plus visually-hidden text (UI.md §5.2 keeps the words available). */
export function StatusTicks({ status }: { status: MessageStatus }) {
  const { t } = useI18n();
  const label = t(`status.${status}`);
  const icon =
    status === 'queued' || status === 'sending' ? (
      <Icon name="clock" size={14} />
    ) : status === 'sent' ? (
      <Icon name="check" size={16} />
    ) : status === 'delivered' ? (
      <Icon name="checks" size={16} />
    ) : status === 'read' ? (
      <span className="tick-read">
        <Icon name="checks" size={16} />
      </span>
    ) : (
      <span className="failed">
        <Icon name="alert" size={14} />
      </span>
    );
  return (
    <span className="ticks" title={label} data-testid="message-status">
      {icon}
      <span className="visually-hidden">{label}</span>
      {(status === 'failed' || status === 'blocked') && <span className="failed"> {label}</span>}
    </span>
  );
}

/** Message menu: quick reactions (+ full picker) and actions. */
function MessageMenu({ client, message: m, onClose, actions, anchor }: { client: EnclaveClient; message: ChatMessage; onClose: () => void; actions: MessageActions; anchor: RefObject<HTMLDivElement | null> }) {
  const { t } = useI18n();
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { refs, floatingStyles } = useFloating({ strategy: 'fixed', placement: m.direction === 'out' ? 'left-start' : 'right-start',
    middleware: [offset(10), flip({ fallbackPlacements: m.direction === 'out' ? ['right-start'] : ['left-start'] }), shift({ padding: 8, crossAxis: true })], whileElementsMounted: autoUpdate });
  useLayoutEffect(() => { refs.setReference(anchor.current); refs.setFloating(root.current); }, [anchor, picker, confirmDelete, refs]);
  useEffect(() => () => anchor.current?.focus({ preventScroll: true }), [anchor]);
  const own = m.authorId === client.accountId;
  const canEdit = own && m.body !== undefined && Date.now() - m.sentAt < EDIT_WINDOW_MS;

  useEffect(() => {
    if (picker || confirmDelete) return undefined;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, picker, confirmDelete]);

  const react = (emoji: string) => {
    onClose();
    void client.react(m, emoji);
  };
  const item = (icon: Parameters<typeof Icon>[0]['name'], label: string, run: () => void, testId?: string, danger = false) => (
    <li role="none">
      <button role="menuitem" className={danger ? 'danger' : ''} data-testid={testId} onClick={run}>
        <span className="menu-icon">
          <Icon name={icon} size={20} />
        </span>
        <span className="menu-label">{label}</span>
      </button>
    </li>
  );

  if (picker) return <div className="message-emoji"><EmojiPicker onPick={react} onClose={onClose} /></div>;
  if (confirmDelete) {
    return (
      <Dialog labelledBy="delete-title" onClose={onClose}>
        <h2 id="delete-title">{t('msg.deleteTitle')}</h2>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          {own && (
            <button className="btn btn-ghost btn-danger" data-testid="delete-everyone" onClick={() => {
              onClose();
              void client.deleteForEveryone(m);
            }}>
              {t('msg.deleteEveryone')}
            </button>
          )}
          <button className="btn btn-ghost btn-danger" data-testid="delete-me" onClick={() => {
            onClose();
            void client.deleteLocally(m);
          }}>
            {t('msg.deleteMe')}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>{t('thread.cancel')}</button>
        </div>
      </Dialog>
    );
  }

  return createPortal(
    <div className={`message-menu floating ${m.direction}`} ref={root} style={floatingStyles} data-testid="message-menu-panel"
      onKeyDown={(e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      <div className="quick-reactions" role="group" aria-label={t('thread.react')}>
        {QUICK_REACTIONS.map((emoji) => (
          <button key={emoji} aria-label={`${t('thread.react')} ${emoji}`} onClick={() => react(emoji)}>
            {emoji}
          </button>
        ))}
        <button aria-label={t('msg.moreReactions')} onClick={() => setPicker(true)}>
          <Icon name="smile" size={20} />
        </button>
      </div>
      <ul className="menu-list static" role="menu" aria-label={t('msg.menu')}>
        {item('info', t('msg.info'), () => {
          onClose();
          actions.onInfo(m);
        })}
        {item('reply', t('thread.reply'), () => {
          onClose();
          actions.onReply(m);
        }, 'action-reply')}
        {m.body && item('copy', t('thread.copy'), () => {
          onClose();
          void navigator.clipboard?.writeText(m.body ?? '');
        })}
        {item('smile', t('thread.react'), () => setPicker(true))}
        {item('next', t('msg.forward'), () => {
          onClose();
          actions.onForward(m);
        }, 'action-forward')}
        {item('pin', m.starred ? t('msg.unstar') : t('msg.star'), () => {
          onClose();
          void client.setStarred(m, !m.starred);
        })}
        {canEdit && item('edit', t('thread.edit'), () => {
          onClose();
          actions.onEdit(m);
        }, 'action-edit')}
        <li role="separator" className="menu-separator" />
        {item('trash', t('msg.delete'), () => setConfirmDelete(true), 'action-delete', true)}
      </ul>
    </div>, document.body,
  );
}

/** Message info dialog: sent time and delivery state. */
export function MessageInfoDialog({ client, message, onClose }: { client: EnclaveClient; message: ChatMessage; onClose: () => void }) {
  const { t, time, date } = useI18n();
  const receipts = Object.entries(message.receipts ?? {});
  const read = receipts.filter(([, r]) => r.readAt);
  const delivered = receipts.filter(([, r]) => r.deliveredAt && !r.readAt);
  const remaining = Math.max(0, (message.recipientAccountIds?.length ?? 0) - receipts.filter(([, r]) => r.deliveredAt).length);
  return (
    <Dialog labelledBy="msg-info-title" onClose={onClose}>
      <h2 id="msg-info-title">{t('msg.info')}</h2>
      {message.body && <div className="bubble" style={{ maxWidth: '100%' }}>{message.body}</div>}
      <dl className="info-list">
        <dt>{t('msg.sentAt')}</dt>
        <dd>{date(message.sentAt)} {time(message.sentAt)}</dd>
        {message.status && (
          <>
            <dt>{t('msg.status')}</dt>
            <dd>{t(`status.${message.status}`)}</dd>
          </>
        )}
      </dl>
      {message.direction === 'out' && <div className="receipt-details">
        <section aria-label={t('receipt.readBy')} data-testid="read-by"><h3><span className="tick-read"><Icon name="checks" size={18} /></span>{t('receipt.readBy')}</h3>
          {read.map(([id, r]) => <ReceiptPerson key={id} client={client} accountId={id} at={r.readAt!} />)}
          {!read.length && <p className="muted-text">{t('receipt.noReads')}</p>}
        </section>
        <section aria-label={t('receipt.deliveredTo')} data-testid="delivered-to"><h3><Icon name="checks" size={18} />{t('receipt.deliveredTo')}</h3>
          {delivered.map(([id, r]) => <ReceiptPerson key={id} client={client} accountId={id} at={r.deliveredAt!} />)}
          {remaining > 0 && <p className="muted-text">{t('receipt.remaining', { count: remaining })}</p>}
        </section>
        <p className="muted-text">{t('receipt.privacy')}</p>
      </div>}
      <button className="btn" onClick={onClose}>{t('newChat.close')}</button>
    </Dialog>
  );
}

function ReceiptPerson({ client, accountId, at }: { client: EnclaveClient; accountId: string; at: number }) {
  const label = useAccountLabel(client, accountId); const { date, time } = useI18n();
  return <div className="receipt-person"><Avatar id={accountId} name={label || '?'} size={40} /><div><strong>{label}</strong><span className="muted-text">{date(at)} · {time(at)}</span></div></div>;
}

function dayLabel(ms: number, today: string, yesterday: string, date: (ms: number) => string): string {
  const d = new Date(ms).toDateString();
  if (d === new Date().toDateString()) return today;
  if (d === new Date(Date.now() - 86_400_000).toDateString()) return yesterday;
  return date(ms);
}
