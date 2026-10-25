import { useEffect, useRef, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { CUSTOM_PACK, EMPTY_COLLECTION, makeStickerImage, type StickerCollection } from '../../core/customStickers';
import type { AttachmentPointer } from '../../crypto/content';
import { findSticker, isAnimatedPack, STICKER_PACKS, stickerPath, verifySticker } from '../../core/stickers';
import { useI18n } from '../i18n/i18n';

/** Verified object URLs per sticker (and motion mode); `null` = missing, unknown or altered (placeholder). */
const verified = new Map<string, Promise<string | null>>();

/** Reduced motion: the OS preference or Settings → Animations off (App sets `data-motion`). */
function motionReduced(): boolean {
  return document.documentElement.dataset.motion === 'off' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** The first frame of an animated image as a still PNG blob. */
async function stillFrame(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no frame'))), 'image/png'));
}

function load(pack: string, id: string): Promise<string | null> {
  const still = isAnimatedPack(pack) && motionReduced();
  const key = `${pack}/${id}${still ? ':still' : ''}`;
  let pending = verified.get(key);
  if (!pending) {
    const sticker = findSticker(pack, id);
    pending = !sticker ? Promise.resolve(null) : fetch(`/${stickerPath(pack, id)}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('missing'))))
      .then(async (bytes) => {
        if (!(await verifySticker(sticker, bytes))) return null;
        const blob = new Blob([bytes], { type: 'image/webp' });
        return URL.createObjectURL(still ? await stillFrame(blob) : blob);
      })
      .catch(() => null);
    verified.set(key, pending);
  }
  return pending;
}

/**
 * A bundled sticker, shown only after its bytes match the pack manifest (AC-MED-04); otherwise a
 * neutral placeholder with the sticker's emoji. Animated stickers show their first frame when
 * motion is reduced.
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

/** Decrypted custom stickers as object URLs (session cache); `null` = unavailable or altered. */
const customUrls = new Map<string, Promise<string | null>>();

/** A personal (custom) sticker: decrypted on this device and checked against its SHA-256 ID. */
export function CustomStickerImage({ client, id, attachment, size = 160 }: { client: EnclaveClient; id: string; attachment?: AttachmentPointer; size?: number }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    let pending = customUrls.get(id);
    if (!pending) {
      pending = client.customStickerBytes({ id, attachment }).then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes.slice()], { type: attachment?.contentType ?? 'image/webp' })) : null));
      customUrls.set(id, pending);
      void pending.then((u) => { if (!u) customUrls.delete(id); }); // retry later (e.g. offline)
    }
    void pending.then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [client, id, attachment]);
  if (url) return <img className="sticker-image" src={url} alt={t('sticker.unknown')} width={size} height={size} draggable={false} data-testid="sticker-image" />;
  return <span className="sticker-placeholder" role="img" aria-label={t('sticker.unknown')} style={{ width: size, height: size }} data-testid={url === null ? 'sticker-placeholder' : undefined}>🏷️</span>;
}

/** Any sticker reference: bundled or custom. */
export function AnySticker({ client, sticker, size }: { client: EnclaveClient; sticker: { pack: string; id: string; attachment?: AttachmentPointer }; size?: number }) {
  return sticker.pack === CUSTOM_PACK ? <CustomStickerImage client={client} id={sticker.id} attachment={sticker.attachment} size={size} /> : <StickerImage pack={sticker.pack} id={sticker.id} size={size} />;
}

/** The personal sticker collection, live. */
export function useStickerCollection(client: EnclaveClient | undefined): StickerCollection {
  const [collection, setCollection] = useState<StickerCollection>(EMPTY_COLLECTION);
  useEffect(() => {
    if (!client) return undefined;
    void client.stickerCollection().then(setCollection);
    return client.on('stickers', setCollection);
  }, [client]);
  return collection;
}

/**
 * Sticker picker (WhatsApp-style): Favourites, My stickers (with Create from a photo) and the
 * bundled packs. Right-click (long-press on touch) a sticker to favourite it or remove one of yours.
 */
export function StickerGrid({ client, onPick }: { client?: EnclaveClient; onPick: (pack: string, id: string) => void }) {
  const { t } = useI18n();
  const collection = useStickerCollection(client);
  const [menu, setMenu] = useState<{ pack: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const favorite = (pack: string, id: string) => collection.favorites.some((f) => f.pack === pack && f.id === id);
  const tile = (pack: string, id: string, title: string, image: React.ReactNode) => (
    <div key={`${pack}/${id}`} className="sticker-tile">
      <button type="button" title={title} aria-label={t('sticker.send', { name: title })} onClick={() => onPick(pack, id)}
        onContextMenu={(e) => { if (!client) return; e.preventDefault(); setMenu({ pack, id }); }} data-testid={`sticker-${id.slice(0, 32)}`}>{image}</button>
      {menu?.pack === pack && menu.id === id && client && (
        <div className="sticker-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(null); void client.toggleFavoriteSticker({ pack, id }); }} data-testid="sticker-favorite">
            {t(favorite(pack, id) ? 'sticker.unfavorite' : 'sticker.favorite')}</button>
          {pack === CUSTOM_PACK && <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); void client.removeCustomSticker(id); }} data-testid="sticker-remove">{t('sticker.remove')}</button>}
        </div>
      )}
    </div>
  );
  const bundled = (pack: string, id: string) => { const s = STICKER_PACKS.find((p) => p.id === pack)?.stickers.find((x) => x.id === id); return s?.alt ?? id; };
  const create = async (picked: File | undefined) => {
    if (!picked || !client) return;
    setBusy(true); setError(false);
    try { await client.addCustomSticker(await makeStickerImage(picked)); } catch { setError(true); } finally { setBusy(false); }
  };
  return (
    <div className="sticker-body" data-testid="sticker-grid">
      {collection.favorites.length > 0 && client && (
        <section>
          <h4>{t('sticker.favorites')}</h4>
          <div className="sticker-grid">{collection.favorites.map((f) => tile(f.pack, f.id, f.pack === CUSTOM_PACK ? t('sticker.unknown') : bundled(f.pack, f.id),
            <AnySticker client={client} sticker={f.pack === CUSTOM_PACK ? { ...f, attachment: collection.custom.find((c) => c.id === f.id)?.pointer } : f} size={72} />))}</div>
        </section>
      )}
      {client && (
        <section>
          <h4>{t('sticker.mine')}</h4>
          <div className="sticker-grid">
            <div className="sticker-tile">
              <button type="button" className="sticker-create" disabled={busy} onClick={() => file.current?.click()} aria-label={t('sticker.create')} title={t('sticker.create')} data-testid="sticker-create">
                {busy ? '…' : '+'}</button>
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void create(e.target.files?.[0]); e.target.value = ''; }} data-testid="sticker-create-input" />
            </div>
            {collection.custom.map((c) => tile(CUSTOM_PACK, c.id, t('sticker.unknown'), <CustomStickerImage client={client} id={c.id} attachment={c.pointer} size={72} />))}
          </div>
          {error && <p role="alert" className="failed">{t('sticker.createFailed')}</p>}
        </section>
      )}
      {STICKER_PACKS.map((pack) => (
        <section key={pack.id}>
          <h4>{pack.title}</h4>
          <div className="sticker-grid">{pack.stickers.map((s) => tile(pack.id, s.id, s.alt, <StickerImage pack={pack.id} id={s.id} size={72} />))}</div>
        </section>
      ))}
    </div>
  );
}
