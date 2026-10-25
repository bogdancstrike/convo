import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage } from '../../core/model';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/**
 * View-once photo/video (specs §30.4), as in WhatsApp: a "①" tile that opens a full-screen viewer
 * once. The media lives only in memory while shown (no download, cache, history or gallery);
 * closing the viewer consumes it here and on this account's other devices. It is best effort:
 * the honest app keeps no copy, but nobody can stop a screenshot or a second camera.
 */
export function ViewOnceTile({ client, message }: { client: EnclaveClient; message: ChatMessage }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const state = message.viewOnce!;
  const label = t(state.kind === 'video' ? 'viewOnce.video' : 'viewOnce.photo');
  const open = async () => {
    setBusy(true); setError(false);
    try { setUrl(URL.createObjectURL(await client.openViewOnce(message))); } catch { setError(true); } finally { setBusy(false); }
  };
  const close = () => {
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    void client.consumeViewOnce(message);
  };
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const status = state.state === 'unopened' ? label : state.state === 'opened' ? t('viewOnce.opened') : label;
  return (
    <>
      <button className={`view-once-tile ${state.state}`} disabled={state.state !== 'unopened' || busy} onClick={() => void open()}
        data-testid="view-once" data-state={state.state} aria-label={state.state === 'unopened' ? t('viewOnce.open', { kind: label }) : status}>
        <span className="view-once-badge" aria-hidden="true">1</span>
        <span>{busy ? t('viewOnce.opening') : status}</span>
        {error && <span className="failed"> · {t('viewOnce.failed')}</span>}
      </button>
      {url && (
        <div className="view-once-viewer" role="dialog" aria-modal="true" aria-label={label} data-testid="view-once-viewer"
          onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => e.key === 'Escape' && close()}>
          <header>
            <button className="icon-btn" onClick={close} aria-label={t('viewOnce.close')} data-testid="view-once-close" autoFocus><Icon name="close" /></button>
            <span>{t('viewOnce.notice')}</span>
          </header>
          {state.kind === 'video'
            ? <video src={url} autoPlay controls controlsList="nodownload noplaybackrate" disablePictureInPicture onEnded={close} />
            : <img src={url} alt={label} draggable={false} />}
        </div>
      )}
    </>
  );
}
