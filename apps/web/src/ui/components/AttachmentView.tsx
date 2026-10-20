import { useEffect, useState } from 'react';
import { AttachmentDownloadError, isInlineImage } from '../../core/attachments';
import type { EnclaveClient } from '../../core/client';
import type { AttachmentPointer } from '../../crypto/content';
import { useI18n } from '../i18n/i18n';

/**
 * Renders one encrypted attachment. Images are downloaded, digest-verified and decrypted on
 * display; other files decrypt only on an explicit Download action (UI.md §5.3). Decrypted data
 * lives in memory as object URLs for this page session only — never in persistent caches.
 */
const objectUrls = new Map<string, string>();

async function decryptToUrl(client: EnclaveClient, pointer: AttachmentPointer): Promise<string> {
  const cached = objectUrls.get(pointer.attachmentId);
  if (cached) return cached;
  const url = URL.createObjectURL(await client.downloadAttachment(pointer));
  objectUrls.set(pointer.attachmentId, url);
  return url;
}

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
  const [url, setUrl] = useState<string | null>(() => objectUrls.get(pointer.attachmentId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const image = isInlineImage(pointer);

  useEffect(() => {
    if (!image || url) return undefined;
    let cancelled = false;
    decryptToUrl(client, pointer)
      .then((u) => !cancelled && setUrl(u))
      .catch((e) => !cancelled && setError(reasonOf(e)));
    return () => {
      cancelled = true;
    };
  }, [client, pointer, image, url]);

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
  if (image && !error) {
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="attachment-image" data-testid="attachment-image">
        <img src={url} alt={name} width={pointer.width} height={pointer.height} />
      </a>
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
