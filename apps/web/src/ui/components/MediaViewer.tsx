import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EnclaveClient } from '../../core/client';
import { isInlineImage, isVideo } from '../../core/attachments';
import type { AttachmentPointer } from '../../crypto/content';
import { useI18n } from '../i18n/i18n';
import { Avatar } from './Avatar';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { clearMediaUrls, decryptMediaUrl } from './mediaUrls';

interface MediaItem { pointer: AttachmentPointer; author?: string; sentAt?: number; caption?: string }
const OpenMedia = createContext<(pointer: AttachmentPointer) => void>(() => {});
export function useMediaViewer() { return useContext(OpenMedia); }

/** Native dialog keeps focus inside the viewer; only authenticated local metadata is enumerated. */
export function MediaViewerProvider({ client, children }: { client: EnclaveClient; children: ReactNode }) {
  const [opened, setOpened] = useState<AttachmentPointer | null>(null);
  useEffect(() => () => clearMediaUrls(), [client]);
  return <OpenMedia.Provider value={setOpened}>{children}{opened && <MediaViewer key={opened.attachmentId} client={client} initial={opened} onClose={() => setOpened(null)} />}</OpenMedia.Provider>;
}

function MediaViewer({ client, initial, onClose }: { client: EnclaveClient; initial: AttachmentPointer; onClose: () => void }) {
  const { t, date, time } = useI18n(); const titleId = useId();
  const [items, setItems] = useState<MediaItem[]>([{ pointer: initial }]);
  const [selected, setSelected] = useState(initial.attachmentId);
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null); const [failed, setFailed] = useState(false);
  const [label, setLabel] = useState(''); const [zoomed, setZoomed] = useState(false);
  const index = Math.max(0, items.findIndex((item) => item.pointer.attachmentId === selected));
  const item = items[index]!; const pointer = item.pointer; const video = isVideo(pointer);
  const url = loaded?.id === pointer.attachmentId ? loaded.url : null;
  const move = (offset: number) => { const target = items[index + offset]; if (target) { setSelected(target.pointer.attachmentId); setZoomed(false); } };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const conversation of client.conversations()) {
        const messages = await client.messages(conversation.id, Number.MAX_SAFE_INTEGER);
        if (!messages.some((m) => !m.deleted && m.attachments?.some((a) => a.attachmentId === initial.attachmentId))) continue;
        const media = messages.filter((m) => !m.deleted && !m.undecryptable).flatMap((m) => (m.attachments ?? [])
          .filter((p) => isInlineImage(p) || isVideo(p)).map((p) => ({ pointer: p, author: m.authorId, sentAt: m.sentAt, caption: m.body })));
        if (!cancelled && media.length) setItems(media);
        break;
      }
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [client, initial.attachmentId]);
  useEffect(() => {
    let cancelled = false; setLoaded(null); setFailed(false);
    void decryptMediaUrl(client, pointer).then((value) => !cancelled && setLoaded({ id: pointer.attachmentId, url: value })).catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; };
  }, [client, pointer]);
  useEffect(() => {
    let cancelled = false; setLabel('');
    if (item.author) void client.displayName(item.author).then((value) => !cancelled && setLabel(value));
    return () => { cancelled = true; };
  }, [client, item.author]);

  return createPortal(<Dialog className="media-viewer" labelledBy={titleId} onClose={onClose}>
    <div className="media-viewer-layout" data-testid="media-viewer" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
    }}>
      <header className="media-viewer-header">
        {item.author && <Avatar id={item.author} name={label} size={40} />}
        <div className="media-viewer-title"><strong id={titleId}>{label || pointer.fileName || t('attachment.photo')}</strong><span className="muted-text">{item.sentAt ? `${date(item.sentAt)} · ${time(item.sentAt)}` : pointer.fileName}</span></div>
        {!video && <button className="icon-btn" onClick={() => setZoomed((value) => !value)} aria-label={t('media.zoom')} aria-pressed={zoomed}><Icon name="search" /></button>}
        <a className="icon-btn" href={url ?? undefined} download={pointer.fileName ?? 'file'} aria-label={t('attachment.download')} aria-disabled={!url} onClick={(e) => { if (!url) e.preventDefault(); }}><Icon name="download" /></a>
        <button className="icon-btn" onClick={onClose} aria-label={t('media.close')} data-testid="close-media"><Icon name="close" /></button>
      </header>
      <div className={`media-viewer-stage${zoomed ? ' zoomed' : ''}`}>
        <button className="icon-btn media-previous" disabled={index === 0} onClick={() => move(-1)} aria-label={t('media.previous')}><Icon name="back" /></button>
        <div className="media-viewer-content">
          {failed ? <p role="alert">{t('attachment.offline')}</p> : !url ? <span role="status">{t('attachment.loading')}</span> : video ?
            <video key={url} src={url} controls autoPlay playsInline data-testid="media-video" /> :
            <img src={url} alt={pointer.fileName ?? t('attachment.photo')} onClick={() => setZoomed((value) => !value)} data-testid="media-image" />}
        </div>
        <button className="icon-btn media-next" disabled={index === items.length - 1} onClick={() => move(1)} aria-label={t('media.next')}><Icon name="next" /></button>
      </div>
      <footer className="media-viewer-footer">
        {item.caption && <p className="media-caption">{item.caption}</p>}
        <div className="media-filmstrip" aria-label={t('shared.media')}>{items.map((entry, i) => <button className="media-thumbnail" key={entry.pointer.attachmentId} aria-label={t('media.item', { index: i + 1, total: items.length })} aria-current={i === index ? 'true' : undefined} onClick={() => { setSelected(entry.pointer.attachmentId); setZoomed(false); }}>
          {entry.pointer.thumbnail ? <img src={`data:image/jpeg;base64,${entry.pointer.thumbnail.replace(/-/g, '+').replace(/_/g, '/')}`} alt="" /> : <Icon name={isVideo(entry.pointer) ? 'play' : 'image'} />}
        </button>)}</div>
      </footer>
    </div>
  </Dialog>, document.body);
}
