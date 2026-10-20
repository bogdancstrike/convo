import { useEffect, useMemo, useState } from 'react';
import { formatBytes } from './AttachmentView';
import { Icon } from './Icon';
import { useI18n } from '../i18n/i18n';

/**
 * Pre-send preview (WhatsApp-style): the selected item large (image, playable video, or a document
 * card), a thumbnail strip to switch/remove/add, a caption field and a send button. Files stay local
 * until Send; then they are encrypted and uploaded.
 */
export function MediaPreview({
  files,
  caption,
  busy,
  progress,
  error,
  onCaption,
  onRemove,
  onAddMore,
  onCancel,
  onSend,
}: {
  files: File[];
  caption: string;
  busy: boolean;
  progress: string | null;
  error: string | null;
  onCaption: (caption: string) => void;
  onRemove: (index: number) => void;
  onAddMore: () => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { t, locale } = useI18n();
  const [index, setIndex] = useState(0);
  const urls = useMemo(() => files.map((f) => (f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  useEffect(() => {
    if (index >= files.length) setIndex(Math.max(0, files.length - 1));
  }, [files.length, index]);

  const current = files[index];
  const url = urls[index];
  if (!current) return null;

  return (
    <div className="media-preview" role="dialog" aria-label={t('preview.title')} data-testid="media-preview"
      onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}>
      <header className="media-preview-header">
        <button className="icon-btn" onClick={onCancel} disabled={busy} aria-label={t('thread.cancel')} data-testid="preview-cancel">
          <Icon name="close" />
        </button>
        <span className="media-preview-name">{current.name}</span>
      </header>
      <div className="media-stage">
        {current.type.startsWith('image/') && url ? (
          <img src={url} alt={current.name} />
        ) : current.type.startsWith('video/') && url ? (
          <video src={url} controls playsInline />
        ) : (
          <div className="doc-card">
            <Icon name="file" size={56} />
            <strong>{current.name}</strong>
            <span className="muted-text">{formatBytes(current.size, locale)} · {current.type || t('attachment.file')}</span>
          </div>
        )}
      </div>
      {error && <p role="alert" className="failed media-error">{error}</p>}
      {progress && <p role="status" className="muted-text media-error">{progress}</p>}
      <div className="media-caption">
        <input
          autoFocus
          className="caption-input"
          placeholder={t('preview.caption')}
          aria-label={t('preview.caption')}
          value={caption}
          maxLength={4000}
          onChange={(e) => onCaption(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && onSend()}
          data-testid="preview-caption"
        />
      </div>
      <footer className="media-strip">
        <ul>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <button className={`thumb${i === index ? ' active' : ''}`} onClick={() => setIndex(i)} aria-label={f.name} aria-current={i === index}>
                {urls[i] && f.type.startsWith('image/') ? <img src={urls[i]!} alt="" /> : <Icon name={f.type.startsWith('video/') ? 'play' : 'file'} />}
              </button>
              <button className="thumb-remove" disabled={busy} onClick={() => onRemove(i)} aria-label={t('thread.removeFile', { name: f.name })}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
          <li>
            <button className="thumb add" onClick={onAddMore} disabled={busy} aria-label={t('preview.addMore')}>
              <Icon name="plus" />
            </button>
          </li>
        </ul>
        <button className="fab" onClick={onSend} disabled={busy} aria-label={t('thread.send')} data-testid="preview-send">
          <Icon name="send" size={24} />
        </button>
      </footer>
    </div>
  );
}
