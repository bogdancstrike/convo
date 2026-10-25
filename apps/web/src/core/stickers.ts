/**
 * Stickers (FR-EXT-01, AC-MED-04): only packs bundled with the app. A sticker message carries just
 * `{ pack, id }` inside the E2EE content; recipients render it from their own copy of the pack, so
 * sending one uploads no media and nothing is fetched from a public CDN.
 *
 * Every sticker file is checked against the SHA-256 in this manifest before it is shown, so an
 * altered or substituted file is refused (rendered as a plain "Sticker" placeholder). Files are
 * bounded (≤ {@link MAX_STICKER_BYTES}) static WebP images. Unknown packs or stickers (e.g. from a
 * newer app version) render as the placeholder with the sticker's emoji when known.
 *
 * The "Convo Basics" and animated "Convo Moves" art is rendered from Noto Color Emoji (SIL Open Font
 * License 1.1) by `scripts/make-stickers.py` and `scripts/make-animated-stickers.py`. Animated packs
 * honour reduced motion: clients show their first frame when the OS asks for reduced motion or the
 * person turned animations off.
 */
export interface Sticker { id: string; emoji: string; alt: string; sha256: string }
/** `animated`: animated WebP (shown as a still image when reduced motion or animations are off). */
export interface StickerPack { id: string; title: string; animated?: boolean; stickers: Sticker[] }

export const MAX_STICKER_BYTES = 128 * 1024;

export const STICKER_PACKS: StickerPack[] = [
  {
    id: 'basics',
    title: 'Convo Basics',
    stickers: [
      { id: 'thumbs-up', emoji: '👍', alt: 'Thumbs up', sha256: '8d8d993b1c27a9f51a4fc81c883124b08b99a5e3bd358147600961fbc902127f' },
      { id: 'heart', emoji: '❤️', alt: 'Red heart', sha256: '96d4cf7e8d3c37a6d08a684bbd7cdd9f02fcfc2ab33105926daee0096d9f286a' },
      { id: 'laugh', emoji: '😂', alt: 'Laughing', sha256: '0d679c393b29a280a2cee22d430de9aeb613fe94ed3c28c4debc36dd2c8d9791' },
      { id: 'thanks', emoji: '🙏', alt: 'Thank you', sha256: 'd4e8eb9a1191d74069fc539b5b455a68759534f0c0f3c277bd0e57d3bad51715' },
      { id: 'party', emoji: '🎉', alt: 'Party popper', sha256: 'ce6b82745c45e1db7bea6117b9fefc3ea11822d476eba7bae516c3127ece4518' },
      { id: 'coffee', emoji: '☕', alt: 'Coffee', sha256: 'a5dbc25d509d94812baf98cfc97d266bcb7a8960bf9eee885bd7e700281e2838' },
      { id: 'thinking', emoji: '🤔', alt: 'Thinking', sha256: '22a793f4d02b008018be5bc445c1ddf42ac714e34c6c4736108c6bbca9d10c90' },
      { id: 'wave', emoji: '👋', alt: 'Waving hand', sha256: 'bce636a2f7bf0ff27389f2549c8da0eba678d50c3b909007a390fda63c1f5113' },
      { id: 'fire', emoji: '🔥', alt: 'Fire', sha256: 'e8c7243cc5f45499fe693b5fb5aaafd99b2a6b28e2d60ef9ea31215857f5ff67' },
      { id: 'clap', emoji: '👏', alt: 'Clapping', sha256: '491ba0594ab04e3bd673481504c1548e00208da2b7bd2f089b7c16628adf6191' },
      { id: 'sleepy', emoji: '😴', alt: 'Sleeping', sha256: 'b52903110eb213aa79312e1d88e5bb15e9930a5a276828eacb104e1b0e3f44f2' },
      { id: 'rocket', emoji: '🚀', alt: 'Rocket', sha256: '0956a368a7115d4746d177f6eccf657ad2864c401c9221445357fcc01511ebc6' },
      { id: 'cool', emoji: '😎', alt: 'Cool', sha256: '6f829e478a5e83dc5f24e30204405e6140180de154bc6bf883293fd768730025' },
      { id: 'hug', emoji: '🤗', alt: 'Hug', sha256: '8d1419c22edc978aeaa713392266ee9049a4ac8b770948026df6736b45dfe55c' },
      { id: 'check', emoji: '✅', alt: 'Done', sha256: '262a9be315b67e39de0661333f6d3ee7746755c87c5d3b69d60ec4ae0c7ed2aa' },
      { id: 'sorry', emoji: '😅', alt: 'Oops', sha256: 'b1d14f6dddc03cbc4077c65e03db2887b7b8eeadc1aaf362833898a9785ebcda' },
    ],
  },
  {
    id: 'moves',
    title: 'Convo Moves',
    animated: true,
    stickers: [
      { id: 'wave', emoji: '👋', alt: 'Waving hand', sha256: '0ed0017ee1ef9f041c22811961c224b672cec9b90b29adcdc138f68ead9b81e6' },
      { id: 'heart-beat', emoji: '❤️', alt: 'Beating heart', sha256: '81d80d1d614506cc2ca7c17e014fc460400c3082aba43122180bdb2f4cec835a' },
      { id: 'laugh', emoji: '😂', alt: 'Laughing', sha256: '90e984a7a0db0a558618370d3260a493b32f8a948132a320fafe19dd2359072c' },
      { id: 'party', emoji: '🎉', alt: 'Party popper', sha256: 'b651246a7fc8369350eab172ef11ae27132b1b10b737607eff12c85691026f8a' },
      { id: 'thumbs-up', emoji: '👍', alt: 'Thumbs up', sha256: '51851434017b27fdbf632f8598cb9c72839b5ac3e174a3e42ecc8e735522b5df' },
      { id: 'fire', emoji: '🔥', alt: 'Fire', sha256: '22829d04d71a272b853e24b19985ca0f06330d0ac8ab58a6e6e5c9335117af21' },
      { id: 'rocket', emoji: '🚀', alt: 'Rocket', sha256: '26298fe06aed5b7e5bcacfb109cd35c233c69ddeae200c7d1e4066c04c8b024f' },
      { id: 'thinking', emoji: '🤔', alt: 'Thinking', sha256: '8a1ab74505f2d4d6cd156908501e3fd8fb6b2f6a65ac5419466e6ff6e2d0b334' },
    ],
  },
];

export function isAnimatedPack(pack: string): boolean { return !!STICKER_PACKS.find((p) => p.id === pack)?.animated; }

export function findSticker(pack: string, id: string): Sticker | undefined {
  return STICKER_PACKS.find((p) => p.id === pack)?.stickers.find((s) => s.id === id);
}

/** Path of a bundled sticker file relative to the app root (web: served; Android: assets). */
export function stickerPath(pack: string, id: string): string { return `stickers/${pack}/${id}.webp`; }

/** Whether `bytes` are exactly the bundled file for this sticker (size bound and SHA-256). */
export async function verifySticker(sticker: Sticker, bytes: ArrayBuffer): Promise<boolean> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_STICKER_BYTES) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('') === sticker.sha256;
}
