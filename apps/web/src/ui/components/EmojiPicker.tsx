import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_CATEGORIES, loadEmojis, recentEmojis, rememberEmoji, type EmojiCatalogue } from '../emoji/emojiData';
import { useI18n } from '../i18n/i18n';
import { Icon } from './Icon';
import { StickerGrid } from './StickerImage';

/**
 * Searchable emoji picker with category tabs and a Recent section. Keyboard: the search field is
 * focused on open, Escape closes, every emoji is a button.
 */
export function EmojiPicker({ onPick, onClose, onSticker, client }: { onPick: (emoji: string) => void; onClose: () => void;
  /** Enables personal stickers (favourites, My stickers, create) in the Stickers tab. */
  client?: import('../../core/client').EnclaveClient;
  /** When given, a Stickers tab sends bundled stickers (composer only, not reactions). */
  onSticker?: (pack: string, id: string) => void }) {
  const { t } = useI18n();
  const [catalogue, setCatalogue] = useState<EmojiCatalogue | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'emoji' | 'stickers'>('emoji');
  const [recent] = useState(recentEmojis);
  const sections = useRef(new Map<string, HTMLElement>());
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadEmojis().then(setCatalogue);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !catalogue) return null;
    return [...catalogue.values()].flat().filter((e) => e.keywords.includes(q)).slice(0, 120);
  }, [catalogue, query]);

  const pick = (emoji: string) => {
    rememberEmoji(emoji);
    onPick(emoji);
  };

  const grid = (emojis: { emoji: string; label: string }[]) => (
    <div className="emoji-grid">
      {emojis.map((e) => (
        <button key={e.emoji} type="button" title={e.label} aria-label={e.label} onClick={() => pick(e.emoji)}>
          {e.emoji}
        </button>
      ))}
    </div>
  );

  return (
    <div className="emoji-picker" ref={root} role="dialog" aria-label={t('emoji.title')} data-testid="emoji-picker">
      {onSticker && (
        <div className="picker-modes" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'emoji'} onClick={() => setMode('emoji')} data-testid="picker-emoji">{t('emoji.title')}</button>
          <button type="button" role="tab" aria-selected={mode === 'stickers'} onClick={() => setMode('stickers')} data-testid="picker-stickers">{t('sticker.title')}</button>
        </div>
      )}
      {mode === 'stickers' && onSticker ? <StickerGrid client={client} onPick={(pack, id) => { onSticker(pack, id); onClose(); }} /> : <>
      <div className="emoji-tabs" role="tablist">
        {recent.length > 0 && (
          <button type="button" role="tab" title={t('emoji.recent')} onClick={() => sections.current.get('recent')?.scrollIntoView()}>
            <Icon name="clock" size={20} />
          </button>
        )}
        {EMOJI_CATEGORIES.map((c) => (
          <button key={c.key} type="button" role="tab" title={t(`emoji.${c.key}`)} onClick={() => sections.current.get(c.key)?.scrollIntoView()}>
            {c.icon}
          </button>
        ))}
      </div>
      <label className="search emoji-search">
        <Icon name="search" size={18} />
        <input autoFocus placeholder={t('emoji.search')} aria-label={t('emoji.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="emoji-body">
        {!catalogue && <p className="muted-text">{t('emoji.loading')}</p>}
        {results ? (
          results.length > 0 ? grid(results) : <p className="muted-text">{t('emoji.none')}</p>
        ) : (
          catalogue && (
            <>
              {recent.length > 0 && (
                <section ref={(el) => void (el && sections.current.set('recent', el))}>
                  <h4>{t('emoji.recent')}</h4>
                  {grid(recent.map((emoji) => ({ emoji, label: emoji })))}
                </section>
              )}
              {EMOJI_CATEGORIES.map((c) => (
                <section key={c.key} ref={(el) => void (el && sections.current.set(c.key, el))}>
                  <h4>{t(`emoji.${c.key}`)}</h4>
                  {grid(catalogue.get(c.id) ?? [])}
                </section>
              ))}
            </>
          )
        )}
      </div>
      </>}
    </div>
  );
}
