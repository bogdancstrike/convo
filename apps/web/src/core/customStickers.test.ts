import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, decodeContent, encodeContent } from '../crypto/content';
import { MAX_FAVORITE_STICKERS, sanitizeCollection, stickerId, validStickerRef } from './customStickers';

const pointer = { attachmentId: '0f0e2b7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b', key: 'k'.repeat(86), digest: 'd'.repeat(43), size: 2048, contentType: 'image/webp', fileName: 'sticker.webp' };

describe('personal stickers', () => {
  it('IDs are the SHA-256 of the image', async () => {
    expect(await stickerId(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('refs: bundled slugs or 64-hex custom IDs only', () => {
    expect(validStickerRef({ pack: 'basics', id: 'heart' })).toBe(true);
    expect(validStickerRef({ pack: 'custom', id: 'a'.repeat(64) })).toBe(true);
    expect(validStickerRef({ pack: 'custom', id: 'heart' })).toBe(false);
    expect(validStickerRef({ pack: '../x', id: 'heart' })).toBe(false);
  });
  it('sanitizes synced collections: drops malformed and duplicate entries, bounds favourites', () => {
    const favorites = Array.from({ length: MAX_FAVORITE_STICKERS + 5 }, (_, i) => ({ pack: 'basics', id: `s${i}` }));
    const c = sanitizeCollection({ mutation: 3, custom: [{ id: 'a'.repeat(64), pointer, uploadedAt: 1, addedAt: 1 }, { id: 'a'.repeat(64), pointer }, { id: 'bad', pointer }],
      favorites: [...favorites, { pack: 'custom', id: 'nope' }] });
    expect(c.custom).toHaveLength(1);
    expect(c.favorites).toHaveLength(MAX_FAVORITE_STICKERS);
    expect(c.mutation).toBe(3);
  });
  it('custom stickers carry a bounded image attachment on the wire; bundled ones carry none', () => {
    const ok = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, sticker: { pack: 'custom', id: 'f'.repeat(64), attachment: pointer } } });
    expect(decodeContent(ok)).toMatchObject({ data: { sticker: { pack: 'custom' } } });
    for (const sticker of [{ pack: 'custom', id: 'f'.repeat(64) }, { pack: 'custom', id: 'f'.repeat(64), attachment: { ...pointer, contentType: 'text/html' } },
      { pack: 'custom', id: 'f'.repeat(64), attachment: { ...pointer, size: 600 * 1024 } }, { pack: 'basics', id: 'heart', attachment: pointer }]) {
      expect(() => decodeContent(encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, sticker } as never }))).toThrow();
    }
  });
});
