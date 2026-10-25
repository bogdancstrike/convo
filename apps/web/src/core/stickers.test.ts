import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, decodeContent, encodeContent } from '../crypto/content';
import { findSticker, MAX_STICKER_BYTES, STICKER_PACKS, stickerPath, verifySticker } from './stickers';

const file = (path: string) => { const b = readFileSync(`${__dirname}/../../public/${path}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

describe('bundled sticker packs (AC-MED-04)', () => {
  it('every manifest entry matches its bundled file and stays within the size bound', async () => {
    for (const pack of STICKER_PACKS) for (const s of pack.stickers) {
      const bytes = file(stickerPath(pack.id, s.id));
      expect(bytes.byteLength).toBeLessThanOrEqual(MAX_STICKER_BYTES);
      expect(await verifySticker(s, bytes), s.id).toBe(true);
    }
  });
  it('refuses altered, substituted or oversized files', async () => {
    const thumbs = findSticker('basics', 'thumbs-up')!;
    const altered = new Uint8Array(file(stickerPath('basics', 'thumbs-up'))); altered[100] ^= 1;
    expect(await verifySticker(thumbs, altered.buffer)).toBe(false);
    expect(await verifySticker(thumbs, file(stickerPath('basics', 'heart')))).toBe(false);
    expect(await verifySticker(thumbs, new ArrayBuffer(MAX_STICKER_BYTES + 1))).toBe(false);
  });
  it('carries only pack and sticker IDs on the wire, validated', () => {
    const ok = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, sticker: { pack: 'basics', id: 'heart' } } });
    expect(decodeContent(ok)).toMatchObject({ data: { sticker: { pack: 'basics', id: 'heart' } } });
    const bad = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, sticker: { pack: '../x', id: 'heart' } } });
    expect(() => decodeContent(bad)).toThrow();
  });
});
