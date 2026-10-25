import { activeMentionQuery, mentionsIn, useGroupMembers, useMentionSuggestions, type MentionCandidate } from '../mentions';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AttachmentRejectedError, MAX_ATTACHMENT_BYTES } from '../../core/attachments';
import { EditNotAllowedError, SendRestrictedError, type EnclaveClient } from '../../core/client';
import { formatInterval } from './MemberPolicy';
import type { ChatMessage, Conversation } from '../../core/model';
import { EmojiPicker } from '../components/EmojiPicker';
import { MediaPreview } from '../components/MediaPreview';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Popover';
import { PollComposer } from './Polls';
import { EventComposer } from './Events';
import { ScheduleDialog, ScheduledBar } from './Scheduled';
import { useI18n } from '../i18n/i18n';
import { formatDuration, useVoiceRecorder } from '../useVoiceRecorder';
import { AckReviewerPicker } from './AckBox';

export type ComposerMode = { kind: 'reply'; target: ChatMessage } | { kind: 'edit'; target: ChatMessage } | null;

/** File pickers behind the attach menu. `capture` opens the camera on supporting devices. */
const PICKERS = [
  { key: 'document', icon: 'file', accept: '', capture: undefined },
  { key: 'media', icon: 'image', accept: 'image/*,video/*', capture: undefined },
  { key: 'camera', icon: 'camera', accept: 'image/*', capture: 'environment' },
  { key: 'audio', icon: 'headphones', accept: 'audio/*', capture: undefined },
] as const;

/**
 * Message composer (UI.md §5.3): attach menu, emoji picker, auto-growing text field with IME-safe
 * Enter, persisted drafts, reply/edit context, pending attachments, and a microphone that turns
 * into a send button once there is something to send. Recording shows cancel · timer ·
 * pause/resume · send.
 */
export function Composer({
  client,
  conversation,
  mode,
  files,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
  authorName,
  onDone,
  openPicker,
  topic,
}: {
  /** Group topic new messages go to (absent = general). */
  topic?: string;
  client: EnclaveClient;
  conversation: Conversation;
  mode: ComposerMode;
  files: File[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onClearFiles: () => void;
  authorName: string;
  onDone: () => void;
  /** Opens a file picker right away (e.g. "Send document" from the home screen). */
  openPicker?: 'document' | null;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(conversation.draft ?? '');
  const [pollOpen, setPollOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);
  const [sendMenu, setSendMenu] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  // @mentions (groups): suggestions for the `@query` at the caret, and the members picked so far.
  const members = useGroupMembers(client, conversation.id);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [picked, setPicked] = useState<MentionCandidate[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const suggestions = useMentionSuggestions(members, mentionQuery?.query ?? null);
  const [caption, setCaption] = useState('');
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emoji, setEmoji] = useState(false);
  // Community announcements: owners/admins may ask members for an explicit acknowledgement.
  const [canRequestAck, setCanRequestAck] = useState(false);
  const [requestAck, setRequestAck] = useState(false);
  // Optional deadlines, in days from sending (0 = none).
  const [ackDue, setAckDue] = useState(0);
  const [ackExpires, setAckExpires] = useState(0);
  // Reviewers besides the publisher; null = default (the community owners).
  const [ackReviewers, setAckReviewers] = useState<string[] | null>(null);
  useEffect(() => {
    if (!conversation.adminOnly) return;
    void client.groupRecord(conversation.id).then((g) => setCanRequestAck(!!g?.community
      && ['owner', 'admin'].includes(g.members.find((m) => m.accountId === client.accountId)?.role ?? '')));
  }, [client, conversation.id, conversation.adminOnly]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const typingSent = useRef(0);
  const recorder = useVoiceRecorder();
  const oversized = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
  const hasContent = text.trim().length > 0;

  useEffect(() => {
    if (mode?.kind === 'edit') setText(mode.target.body ?? '');
    if (mode) textarea.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (openPicker) inputs.current.get(openPicker)?.click();
  }, [openPicker]);

  // Auto-grow up to the CSS max height.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Persist the draft (debounced) so it survives reloads (UI.md §1.1 "preserve work").
  useEffect(() => {
    if (mode?.kind === 'edit') return undefined;
    const timer = setTimeout(() => {
      if ((conversation.draft ?? '') !== text) void client.updateConversation(conversation.id, { draft: text || undefined });
    }, 400);
    return () => clearTimeout(timer);
  }, [client, conversation.id, conversation.draft, text, mode]);

  /** Group policy refusals: restricted member, or slow mode with the wait left. */
  const restrictedMessage = (e: SendRestrictedError) => e.reason === 'restricted' ? t('slow.restricted')
    : t('slow.wait', { time: formatInterval(Math.max(1, Math.ceil(((e.retryAt ?? Date.now()) - Date.now()) / 1000)), t) });

  const sendFiles = async () => {
    const selected = files;
    setError(null);
    setUpload({ done: 0, total: selected.length });
    try {
      await client.sendAttachments(conversation.id, selected, caption.trim(), (done) => setUpload({ done, total: selected.length }), { viewOnce: viewOnce && selected.length === 1 });
      setViewOnce(false);
      setCaption('');
      onClearFiles();
      onDone();
    } catch (e) {
      setError(
        e instanceof AttachmentRejectedError
          ? t(e.reason === 'too-large' ? 'attachment.tooLarge' : 'attachment.unreadable', { name: e.fileName, limit: String(MAX_ATTACHMENT_BYTES / 1048576) })
          : e instanceof SendRestrictedError ? restrictedMessage(e) : t('attachment.uploadFailed'),
      );
    } finally {
      setUpload(null);
    }
  };

  /** Sends the text; `silent` = quiet send, `dueAt` = schedule it on this device instead. */
  const submit = async (options: { silent?: boolean; dueAt?: number } = {}) => {
    if (upload) return;
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
        const day = 24 * 60 * 60 * 1000;
        const ack = requestAck && { ...(ackDue ? { due: Date.now() + ackDue * day } : {}), ...(ackExpires ? { expires: Date.now() + ackExpires * day } : {}),
          ...(ackReviewers ? { reviewers: ackReviewers } : {}) };
        if (options.dueAt) await client.scheduleMessage(conversation.id, body, options.dueAt, { quote, mentions: mentionsIn(body, picked), silent: options.silent });
        else await client.sendText(conversation.id, body, quote, mentionsIn(body, picked), ack, { silent: options.silent, topic });
        setPicked([]);
        setRequestAck(false);
        setAckDue(0);
        setAckExpires(0);
      }
      void client.sendTyping(conversation.id, 'stopped');
    } catch (e) {
      if (e instanceof EditNotAllowedError) { setError(t('thread.editExpired')); return; }
      if (e instanceof SendRestrictedError) { setText((typed) => (typed ? typed : body)); setError(restrictedMessage(e)); return; }
      // Local persistence failed (e.g. storage full): give the text back instead of losing it.
      setText((typed) => (typed ? typed : body));
      console.warn('Could not queue message', e instanceof Error ? e.message : e);
    }
  };

  const sendVoice = async () => {
    const note = await recorder.stop();
    if (!note) return;
    setUpload({ done: 0, total: 1 });
    setError(null);
    try {
      await client.sendVoiceNote(conversation.id, note.file, note.durationMs);
    } catch (e) {
      setError(e instanceof SendRestrictedError ? restrictedMessage(e) : t('attachment.uploadFailed'));
    } finally {
      setUpload(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => (h + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(suggestions[highlighted] ?? suggestions[0]!); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
    }
    // IME composition Enter never sends (UI.md §5.3).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && client.settings.enterToSend) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && mode) {
      onDone();
      if (mode.kind === 'edit') setText('');
    }
  };

  const pickMention = (member: MentionCandidate) => {
    if (!mentionQuery) return;
    const caret = textarea.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mentionQuery.start)}@${member.label} ${text.slice(caret)}`;
    pendingCaret.current = mentionQuery.start + member.label.length + 2;
    setText(next); setPicked((p) => [...p.filter((m) => m.accountId !== member.accountId), member]); setMentionQuery(null);
  };
  // Applied synchronously after the text update, before any further keystroke is handled.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    textarea.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    textarea.current?.focus();
    pendingCaret.current = null;
  }, [text]);

  const onChange = (value: string) => {
    setText(value);
    setMentionQuery(members.length ? activeMentionQuery(value, textarea.current?.selectionStart ?? value.length) : null);
    setHighlighted(0);
    if (value && Date.now() - typingSent.current > 5000) {
      typingSent.current = Date.now();
      void client.sendTyping(conversation.id, 'started');
    }
  };

  const insertEmoji = (value: string) => {
    const el = textarea.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + value + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const recording = recorder.state === 'recording' || recorder.state === 'paused';

  return (
    <div className="composer-wrap">
      {pollOpen && <PollComposer client={client} conversationId={conversation.id} onClose={() => setPollOpen(false)} />}
      {eventOpen && <EventComposer client={client} conversationId={conversation.id} onClose={() => setEventOpen(false)} />}
      {scheduling && <ScheduleDialog onSchedule={(dueAt) => submit({ dueAt })} onClose={() => setScheduling(false)} />}
      {sendMenu && (
        <div className="send-options" role="menu" data-testid="send-options" onKeyDown={(e) => e.key === 'Escape' && setSendMenu(false)}>
          <button role="menuitem" autoFocus onClick={() => { setSendMenu(false); void submit({ silent: true }); }} data-testid="send-quiet"><Icon name="mute" size={18} /> {t('schedule.sendQuiet')}</button>
          <button role="menuitem" onClick={() => { setSendMenu(false); setScheduling(true); }} data-testid="send-schedule"><Icon name="clock" size={18} /> {t('schedule.title')}</button>
          <button role="menuitem" onClick={() => setSendMenu(false)}><Icon name="close" size={18} /> {t('thread.cancel')}</button>
        </div>
      )}
      {conversation.kind !== 'note' && <ScheduledBar client={client} conversationId={conversation.id} />}
      {PICKERS.map((p) => (
        <input
          key={p.key}
          ref={(el) => void (el && inputs.current.set(p.key, el))}
          type="file"
          multiple={p.key !== 'camera'}
          accept={p.accept || undefined}
          capture={p.capture}
          hidden
          data-testid={p.key === 'document' ? 'file-input' : `file-input-${p.key}`}
          onChange={(e) => {
            onAddFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      ))}
      {files.length > 0 && mode?.kind !== 'edit' && (
        <MediaPreview
          files={files}
          caption={caption}
          busy={!!upload}
          blocked={!!oversized}
          progress={upload ? t('thread.uploading', { done: upload.done, total: upload.total }) : null}
          error={oversized ? t('attachment.tooLarge', { name: oversized.name, limit: String(MAX_ATTACHMENT_BYTES / 1048576) }) : error}
          onCaption={setCaption}
          viewOnce={viewOnce}
          onViewOnce={conversation.kind === 'note' || !client.policy.features.viewOnce ? undefined : setViewOnce}
          onRemove={onRemoveFile}
          onAddMore={() => inputs.current.get('document')?.click()}
          onCancel={() => {
            setCaption('');
            setError(null);
            onClearFiles();
          }}
          onSend={() => !oversized && void sendFiles()}
        />
      )}
      {upload && files.length === 0 && <div role="status" className="muted-text">{t('thread.uploading', { done: upload.done, total: upload.total })}</div>}
      {error && files.length === 0 && <div role="alert" className="failed">{error}</div>}
      {recorder.state === 'denied' && <div role="alert" className="failed">{t('composer.micDenied')}</div>}
      {recorder.state === 'unsupported' && <div role="alert" className="failed">{t('composer.micUnsupported')}</div>}
      {mode && (
        <div className="composer-context">
          <span>
            <strong>{mode.kind === 'reply' ? t('thread.replyingTo', { name: authorName }) : t('thread.editing')}</strong>
            {mode.kind === 'reply' && <> · {mode.target.body ?? ''}</>}
          </span>
          <button
            className="icon-btn"
            aria-label={t('thread.cancel')}
            onClick={() => {
              if (mode.kind === 'edit') setText('');
              onDone();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {canRequestAck && mode?.kind !== 'edit' && (
        <div className="ack-toggle">
          <label><input type="checkbox" checked={requestAck} onChange={(e) => setRequestAck(e.target.checked)} data-testid="request-ack" /> {t('ack.requestToggle')}</label>
          {requestAck && (
            <>
              <label>{t('ack.dueLabel')}{' '}
                <select value={ackDue} onChange={(e) => { const v = Number(e.target.value); setAckDue(v); if (ackExpires && v > ackExpires) setAckExpires(v); }} data-testid="ack-due">
                  <option value={0}>{t('ack.none')}</option><option value={1}>{t('ack.in1d')}</option><option value={3}>{t('ack.in3d')}</option><option value={7}>{t('ack.in7d')}</option>
                </select>
              </label>
              <label>{t('ack.expiresLabel')}{' '}
                <select value={ackExpires} onChange={(e) => setAckExpires(Number(e.target.value))} data-testid="ack-expires">
                  <option value={0}>{t('ack.never')}</option>
                  {[1, 3, 7, 30].filter((d) => d >= ackDue).map((d) => <option key={d} value={d}>{t(d === 1 ? 'ack.in1d' : d === 3 ? 'ack.in3d' : d === 7 ? 'ack.in7d' : 'ack.in30d')}</option>)}
                </select>
              </label>
              <AckReviewerPicker client={client} conversationId={conversation.id} value={ackReviewers} onChange={setAckReviewers} />
            </>
          )}
        </div>
      )}
      <div className="composer">
        {recording ? (
          <div className="recording-bar" role="group" aria-label={t('composer.recording')}>
            <button className="icon-btn" onClick={() => void recorder.cancel()} aria-label={t('composer.cancelRecording')}>
              <Icon name="trash" />
            </button>
            <span className={`rec-dot${recorder.state === 'recording' ? ' live' : ''}`} aria-hidden="true" />
            <span className="rec-time" aria-live="off">{formatDuration(recorder.elapsed)}</span>
            <span className="rec-wave" aria-hidden="true" />
            <button
              className="icon-btn"
              onClick={recorder.state === 'recording' ? recorder.pause : recorder.resume}
              aria-label={recorder.state === 'recording' ? t('composer.pause') : t('composer.resume')}
            >
              <Icon name={recorder.state === 'recording' ? 'pause' : 'mic'} />
            </button>
            <button className="send-btn" onClick={() => void sendVoice()} aria-label={t('composer.sendVoice')} data-testid="send-voice">
              <Icon name="send" size={20} />
            </button>
          </div>
        ) : (
          <div className="composer-row">
            <Menu
              label={t('thread.attach')}
              placement="above-start"
              className="attach-menu"
              items={[...PICKERS.map((p) => ({
                label: t(`attach.${p.key}`),
                icon: p.icon,
                testId: `attach-${p.key}`,
                onSelect: () => inputs.current.get(p.key)?.click(),
              })), ...(conversation.kind !== 'note' ? [{ label: t('attach.poll'), icon: 'poll' as const, testId: 'attach-poll', onSelect: () => setPollOpen(true) },
                { label: t('attach.event'), icon: 'clock' as const, testId: 'attach-event', onSelect: () => setEventOpen(true) }] : [])]}
              trigger={({ open, toggle }) => (
                <button
                  className="icon-btn"
                  aria-label={t('thread.attach')}
                  aria-expanded={open}
                  aria-pressed={open}
                  onClick={toggle}
                  disabled={mode?.kind === 'edit' || !!upload}
                  data-testid="attach-button"
                >
                  <Icon name="paperclip" />
                </button>
              )}
            />
            <div className="emoji-anchor">
              <button className="icon-btn" aria-label={t('composer.emoji')} aria-pressed={emoji} onClick={() => setEmoji((v) => !v)} data-testid="emoji-button">
                <Icon name="smile" />
              </button>
              {emoji && <EmojiPicker client={client} onPick={insertEmoji} onClose={() => setEmoji(false)}
                onSticker={!client.policy.features.stickers ? undefined : (pack, id) => void client.sendSticker(conversation.id, pack, id, { topic }).then(onDone).catch((e) => setError(e instanceof SendRestrictedError ? restrictedMessage(e) : t('sticker.failed')))} />}
            </div>
            <label className="visually-hidden" htmlFor="composer">
              {t('thread.placeholder')}
            </label>
            {suggestions.length > 0 && (
              <ul className="mention-suggestions" role="listbox" aria-label={t('mention.suggestions')} data-testid="mention-suggestions">
                {suggestions.map((m, i) => (
                  <li key={m.accountId} role="option" aria-selected={i === highlighted}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(m)} data-testid={`mention-${m.label}`}>@{m.label}</button>
                  </li>
                ))}
              </ul>
            )}
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
            {hasContent || mode?.kind === 'edit' ? (
              <button
                className="send-btn"
                onClick={() => void submit()}
                // Right-click / long-press: quiet send or schedule (not while editing).
                onContextMenu={(e) => { if (mode?.kind === 'edit') return; e.preventDefault(); setSendMenu(true); }}
                disabled={!!upload || !!oversized}
                aria-label={mode?.kind === 'edit' ? t('thread.save') : t('thread.send')}
                data-testid="send"
              >
                <Icon name={mode?.kind === 'edit' ? 'check' : 'send'} size={20} />
              </button>
            ) : (
              <button className="send-btn mic" onClick={() => void recorder.start()} aria-label={t('composer.record')} data-testid="record">
                <Icon name="mic" size={22} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
