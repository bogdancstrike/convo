import type { AttachmentPointer } from '../crypto/content';

/**
 * Personal stickers (WhatsApp-style): stickers made from your own images or saved from chats, plus
 * favourites across all stickers. A custom sticker is an encrypted attachment like a photo; its ID
 * is the hex SHA-256 of the image, so every device checks the decrypted bytes against it. The
 * collection is private and synced to this account's own devices only (highest mutation wins).
 */
export const CUSTOM_PACK = 'custom';
export const MAX_CUSTOM_STICKER_BYTES = 512 * 1024;
export const MAX_CUSTOM_STICKERS = 200;
export const MAX_FAVORITE_STICKERS = 60;
/** Sticker image side (px): created stickers are square WebP at this size. */
export const CUSTOM_STICKER_SIZE = 512;
/** Server copies expire (30 days); a sticker uploaded longer ago than this is re-uploaded on send. */
export const STICKER_REUPLOAD_AFTER_MS = 25 * 24 * 3600_000;

export interface StickerRef { pack: string; id: string }
export interface CustomSticker { id: string; pointer: AttachmentPointer; uploadedAt: number; addedAt: number }
export interface StickerCollection { custom: CustomSticker[]; favorites: StickerRef[]; mutation: number }

export const EMPTY_COLLECTION: StickerCollection = { custom: [], favorites: [], mutation: 0 };

const HEX64 = /^[0-9a-f]{64}$/;
const BUNDLED_ID = /^[a-z0-9-]{1,32}$/;

export function isCustomStickerId(id: string): boolean { return HEX64.test(id); }

/** A sticker reference as it may appear on the wire or in a collection. */
export function validStickerRef(ref: StickerRef): boolean {
  return ref.pack === CUSTOM_PACK ? HEX64.test(ref.id) : BUNDLED_ID.test(ref.pack) && BUNDLED_ID.test(ref.id);
}

/** Drops malformed entries and duplicates, and bounds the sizes (synced input is untrusted). */
export function sanitizeCollection(value: { custom?: unknown; favorites?: unknown; mutation?: unknown }): StickerCollection {
  const seen = new Set<string>();
  const custom = (Array.isArray(value.custom) ? value.custom : []).filter((c): c is CustomSticker => {
    const s = c as CustomSticker;
    if (!s || typeof s.id !== 'string' || !HEX64.test(s.id) || seen.has(s.id) || !s.pointer || typeof s.pointer !== 'object') return false;
    seen.add(s.id); return true;
  }).slice(0, MAX_CUSTOM_STICKERS).map((s) => ({ id: s.id, pointer: s.pointer, uploadedAt: Number(s.uploadedAt) || 0, addedAt: Number(s.addedAt) || 0 }));
  const favSeen = new Set<string>();
  const favorites = (Array.isArray(value.favorites) ? value.favorites : []).filter((f): f is StickerRef => {
    const r = f as StickerRef;
    if (!r || typeof r.pack !== 'string' || typeof r.id !== 'string' || !validStickerRef(r)) return false;
    const key = `${r.pack}/${r.id}`; if (favSeen.has(key)) return false; favSeen.add(key); return true;
  }).slice(0, MAX_FAVORITE_STICKERS).map((r) => ({ pack: r.pack, id: r.id }));
  return { custom, favorites, mutation: Number.isSafeInteger(value.mutation) ? Number(value.mutation) : 0 };
}

/** Hex SHA-256 of sticker bytes (the custom sticker's ID). */
export async function stickerId(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A square 512 px WebP sticker from an image file: the whole picture, scaled to fit on a transparent
 * background (like WhatsApp's "create sticker"); quality is lowered until it fits the size limit.
 */
export async function makeStickerImage(file: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CUSTOM_STICKER_SIZE;
  const scale = Math.min(CUSTOM_STICKER_SIZE / bitmap.width, CUSTOM_STICKER_SIZE / bitmap.height);
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, (CUSTOM_STICKER_SIZE - w) / 2, (CUSTOM_STICKER_SIZE - h) / 2, w, h);
  bitmap.close();
  for (const quality of [0.9, 0.8, 0.65, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (blob && blob.size <= MAX_CUSTOM_STICKER_BYTES) return new Uint8Array(await blob.arrayBuffer());
  }
  throw new Error('sticker image too large');
}
