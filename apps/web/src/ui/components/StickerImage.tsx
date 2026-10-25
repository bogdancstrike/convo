import { useEffect, useState } from 'react';
import { findSticker, STICKER_PACKS, stickerPath, verifySticker } from '../../core/stickers';
import { useI18n } from '../i18n/i18n';

/** Verified object URLs per sticker; `null` = missing, unknown or altered (shown as a placeholder). */
const verified = new Map<string, Promise<string | null>>();

function load(pack: string, id: string): Promise<string | null> {
  const key = `${pack}/${id}`;
  let pending = verified.get(key);
  if (!pending) {
    const sticker = findSticker(pack, id);
    pending = !sticker ? Promise.resolve(null) : fetch(`/${stickerPath(pack, id)}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing'))))
      .then(async (bytes) => (await verifySticker(sticker, bytes) ? URL.createObjectURL(new Blob([bytes], { type: 'image/webp' })) : null))
      .catch(() => null);
    verified.set(key, pending);
  }
  return pending;
}

/**
 * A bundled sticker, shown only after its bytes match the pack manifest (AC-MED-04); otherwise a
 * neutral placeholder with the sticker's emoji. Static images only, so reduced motion needs nothing.
 */
export function StickerImage({ pack, id, size = 160 }: { pack: string; id: string; size?: number }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => { let live = true; void load(pack, id).then((u) => { if (live) setUrl(u); }); return () => { live = false; }; }, [pack, id]);
  const sticker = findSticker(pack, id);
  const alt = sticker ? t('sticker.alt', { name: sticker.alt }) : t('sticker.unknown');
  if (url) return <img className="sticker-image" src={url} alt={alt} width={size} height={size} draggable={false} data-testid="sticker-image" />;
  return <span className="sticker-placeholder" role="img" aria-label={alt} style={{ width: size, height: size }} data-testid={url === null ? 'sticker-placeholder' : undefined}>{sticker?.emoji ?? '🏷️'}</span>;
}

/** Grid of the bundled packs for the composer picker. */
export function StickerGrid({ onPick }: { onPick: (pack: string, id: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="sticker-body">
      {STICKER_PACKS.map((pack) => (
        <section key={pack.id}>
          <h4>{pack.title}</h4>
          <div className="sticker-grid">
            {pack.stickers.map((s) => (
              <button key={s.id} type="button" title={s.alt} aria-label={t('sticker.send', { name: s.alt })} onClick={() => onPick(pack.id, s.id)} data-testid={`sticker-${s.id}`}>
                <StickerImage pack={pack.id} id={s.id} size={72} />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
