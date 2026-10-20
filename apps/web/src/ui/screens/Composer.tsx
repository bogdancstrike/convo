import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AttachmentRejectedError, MAX_ATTACHMENT_BYTES } from '../../core/attachments';
import { EditNotAllowedError, type EnclaveClient } from '../../core/client';
import type { ChatMessage, Conversation } from '../../core/model';
import { EmojiPicker } from '../components/EmojiPicker';
import { MediaPreview } from '../components/MediaPreview';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Popover';
import { useI18n } from '../i18n/i18n';
import { formatDuration, useVoiceRecorder } from '../useVoiceRecorder';

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
  /** Opens a file picker right away (e.g. "Send document" from the home screen). */
  openPicker?: 'document' | null;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(conversation.draft ?? '');
  const [caption, setCaption] = useState('');
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emoji, setEmoji] = useState(false);
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

  const sendFiles = async () => {
    const selected = files;
    setError(null);
    setUpload({ done: 0, total: selected.length });
    try {
      await client.sendAttachments(conversation.id, selected, caption.trim(), (done) => setUpload({ done, total: selected.length }));
      setCaption('');
      onClearFiles();
      onDone();
    } catch (e) {
      setError(
        e instanceof AttachmentRejectedError
          ? t(e.reason === 'too-large' ? 'attachment.tooLarge' : 'attachment.unreadable', { name: e.fileName, limit: String(MAX_ATTACHMENT_BYTES / 1048576) })
          : t('attachment.uploadFailed'),
      );
    } finally {
      setUpload(null);
    }
  };

  const submit = async () => {
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
        await client.sendText(conversation.id, body, quote);
      }
      void client.sendTyping(conversation.id, 'stopped');
    } catch (e) {
      if (e instanceof EditNotAllowedError) { setError(t('thread.editExpired')); return; }
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
    } catch {
      setError(t('attachment.uploadFailed'));
    } finally {
      setUpload(null);
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
              items={PICKERS.map((p) => ({
                label: t(`attach.${p.key}`),
                icon: p.icon,
                testId: `attach-${p.key}`,
                onSelect: () => inputs.current.get(p.key)?.click(),
              }))}
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
              {emoji && <EmojiPicker onPick={insertEmoji} onClose={() => setEmoji(false)} />}
            </div>
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
            {hasContent || mode?.kind === 'edit' ? (
              <button
                className="send-btn"
                onClick={() => void submit()}
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
