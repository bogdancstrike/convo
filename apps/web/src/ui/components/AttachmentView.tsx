import { useEffect, useRef, useState } from 'react';
import { AttachmentDownloadError, isAudio, isInlineImage, isVideo } from '../../core/attachments';
import type { EnclaveClient } from '../../core/client';
import type { AttachmentPointer } from '../../crypto/content';
import { useI18n } from '../i18n/i18n';
import { formatDuration } from '../useVoiceRecorder';
import { Icon } from './Icon';
import { useMediaViewer } from './MediaViewer';
import { decryptMediaUrl as decryptToUrl } from './mediaUrls';

/**
 * Renders one encrypted attachment. Images are downloaded, digest-verified and decrypted on
 * display; other files decrypt only on an explicit Download action (UI.md §5.3). Decrypted data
 * lives in memory as object URLs for this page session only — never in persistent caches.
 */
export function formatBytes(size: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

export function AttachmentView({ client, pointer }: { client: EnclaveClient; pointer: AttachmentPointer }) {
  const { t, locale } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const openMedia = useMediaViewer();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const image = isInlineImage(pointer);
  const audio = isAudio(pointer);

  useEffect(() => {
    if (!(image || audio) || url) return undefined;
    let cancelled = false;
    decryptToUrl(client, pointer)
      .then((u) => !cancelled && setUrl(u))
      .catch((e) => !cancelled && setError(reasonOf(e)));
    return () => {
      cancelled = true;
    };
  }, [client, pointer, image, audio, url]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const href = await decryptToUrl(client, pointer);
      const a = document.createElement('a');
      a.href = href;
      a.download = pointer.fileName ?? 'file';
      a.rel = 'noopener';
      a.click();
    } catch (e) {
      setError(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const name = pointer.fileName ?? (image ? t('attachment.photo') : t('attachment.file'));
  if (audio && !error) return <AudioPlayer url={url} pointer={pointer} />;
  if (isVideo(pointer) && !error) return <VideoView pointer={pointer} />;
  if (image && !error) {
    return url ? (
      <button type="button" onClick={() => openMedia(pointer)} aria-label={name} className="attachment-image" data-testid="attachment-image">
        <img src={url} alt={name} width={pointer.width} height={pointer.height} />
      </button>
    ) : (
      <div
        className="attachment-image placeholder"
        role="img"
        aria-label={t('attachment.loading')}
        style={{ aspectRatio: pointer.width && pointer.height ? `${pointer.width} / ${pointer.height}` : '4 / 3' }}
      />
    );
  }
  return (
    <div className="attachment-file" data-testid="attachment-file">
      <span aria-hidden="true">📎</span>
      <span className="name">
        {name}
        <span className="muted-text"> · {formatBytes(pointer.size, locale)}</span>
      </span>
      <button className="btn" onClick={() => void save()} disabled={busy}>
        {t('attachment.download')}
      </button>
      {error && (
        <span role="alert" className="failed">
          {t(`attachment.${error}` as 'attachment.expired')}
        </span>
      )}
    </div>
  );
}

function reasonOf(error: unknown): 'expired' | 'offline' | 'integrity' {
  return error instanceof AttachmentDownloadError ? error.reason : 'offline';
}

/** Inline player for voice notes and audio files (decrypted into a session object URL). */
function AudioPlayer({ url, pointer }: { url: string | null; pointer: AttachmentPointer }) {
  const { t } = useI18n();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(pointer.durationMs ?? 0);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <div className="audio-player" data-testid="audio-player">
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration * 1000)}
        />
      )}
      <button className="icon-btn" onClick={toggle} disabled={!url} aria-label={playing ? t('composer.pause') : t('msg.play')}>
        <Icon name={playing ? 'pause' : 'play'} filled={!playing} />
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(1, duration)}
        value={Math.min(position, duration)}
        aria-label={pointer.voiceNote ? t('msg.voiceNote') : (pointer.fileName ?? t('attachment.file'))}
        onChange={(e) => {
          if (audio.current) audio.current.currentTime = Number(e.target.value) / 1000;
        }}
      />
      <span className="audio-time">{formatDuration(playing || position > 0 ? position : duration)}</span>
      {pointer.voiceNote && <Icon name="mic" size={18} />}
    </div>
  );
}

/**
 * Inline video: shows the encrypted-in-message poster with duration; the video itself is downloaded,
 * digest-verified and decrypted only when the user presses play (videos can be large).
 */
function VideoView({ pointer }: { pointer: AttachmentPointer }) {
  const { t } = useI18n(); const openMedia = useMediaViewer();
  const poster = pointer.thumbnail ? `data:image/jpeg;base64,${pointer.thumbnail.replace(/-/g, '+').replace(/_/g, '/')}` : undefined;
  const ratio = pointer.width && pointer.height ? `${pointer.width} / ${pointer.height}` : '16 / 9';
  return <button className="attachment-video poster" style={{ aspectRatio: ratio, backgroundImage: poster ? `url("${poster}")` : undefined }}
    onClick={() => openMedia(pointer)} aria-label={`${t('msg.play')} ${pointer.fileName ?? ''}`} data-testid="video-poster">
    <span className="play-badge"><Icon name="play" filled size={26} /></span>
    {pointer.durationMs !== undefined && <span className="video-duration">{formatDuration(pointer.durationMs)}</span>}
  </button>;
}
