/**
 * Emoji catalogue for the picker, lazy-loaded from the bundled MIT-licensed `emojibase-data`
 * (no network requests; works air-gapped). Glyphs render with the system emoji font.
 */

/** One pickable emoji. */
export interface EmojiEntry {
  emoji: string;
  label: string;
  /** Lower-case label + tags, used for search. */
  keywords: string;
}

/** Picker categories (emojibase group IDs; skin-tone "component" group omitted). */
export const EMOJI_CATEGORIES = [
  { id: 0, key: 'smileys', icon: '😀' },
  { id: 1, key: 'people', icon: '👋' },
  { id: 3, key: 'nature', icon: '🐻' },
  { id: 4, key: 'food', icon: '🍔' },
  { id: 5, key: 'travel', icon: '🚗' },
  { id: 6, key: 'activities', icon: '⚽' },
  { id: 7, key: 'objects', icon: '💡' },
  { id: 8, key: 'symbols', icon: '❤️' },
  { id: 9, key: 'flags', icon: '🏳️' },
] as const;

export type EmojiCatalogue = Map<number, EmojiEntry[]>;

let catalogue: Promise<EmojiCatalogue> | null = null;

interface EmojibaseEmoji {
  group?: number;
  order?: number;
  label: string;
  tags?: string[];
  emoji: string;
  version: number;
}

/**
 * Whether the device's emoji font can draw a glyph: real emoji render coloured pixels, while a
 * missing glyph renders a monochrome "tofu" box (or nothing).
 */
function canRender(emoji: string): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 20;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    ctx.textBaseline = 'top';
    ctx.font = '16px sans-serif';
    ctx.fillText(emoji, 0, 0);
    const pixels = ctx.getImageData(0, 0, 20, 20).data;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b, a] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!];
      if (a > 0 && (Math.abs(r - g) > 20 || Math.abs(g - b) > 20)) return true;
    }
    return false;
  } catch {
    return true; // cannot probe (e.g. tests): show everything
  }
}

/** Emoji versions ≥ 11 whose first glyph this device cannot render (older ones are universal). */
function unsupportedVersions(data: EmojibaseEmoji[]): Set<number> {
  const firstByVersion = new Map<number, string>();
  for (const e of data) if (e.version >= 11 && !firstByVersion.has(e.version)) firstByVersion.set(e.version, e.emoji);
  return new Set([...firstByVersion].filter(([, emoji]) => !canRender(emoji)).map(([version]) => version));
}

/** Loads (once) and groups the catalogue by category in display order. */
export function loadEmojis(): Promise<EmojiCatalogue> {
  catalogue ??= import('emojibase-data/en/data.json').then((module) => {
    const data = (module.default ?? module) as unknown as EmojibaseEmoji[];
    const hidden = unsupportedVersions(data);
    const byGroup: EmojiCatalogue = new Map();
    [...data]
      .filter((e) => e.group !== undefined && e.group !== 2 && !hidden.has(e.version))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .forEach((e) => {
        const list = byGroup.get(e.group!) ?? [];
        list.push({ emoji: e.emoji, label: e.label, keywords: [e.label, ...(e.tags ?? [])].join(' ').toLowerCase() });
        byGroup.set(e.group!, list);
      });
    return byGroup;
  });
  return catalogue;
}

const RECENT_KEY = 'enclave.emoji.recent';
const RECENT_MAX = 24;

/** Recently used emojis (per-browser convenience; failures are ignored). */
export function recentEmojis(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Records an emoji as recently used. */
export function rememberEmoji(emoji: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recentEmojis().filter((e) => e !== emoji)].slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable (private mode): recents simply are not kept */
  }
}
