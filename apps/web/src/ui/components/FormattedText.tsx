import { Fragment, type ReactNode } from 'react';

/**
 * Safe basic formatting (UI.md §5.3): `*bold*`, `_italic_`, `` `code` `` and `> quote` lines,
 * rendered as React elements — never via innerHTML — so message text cannot inject markup.
 * URLs are shown as text, not auto-linked: opening a link must be an explicit action with the
 * destination visible. `highlight` marks in-conversation search matches (case/diacritic-insensitive).
 */
const INLINE = /(`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Wraps search matches in <mark>; works on the folded text so "stefan" matches "Ștefan". */
function marked(text: string, highlight: string | undefined, key: string): ReactNode {
  const needle = highlight ? fold(highlight.trim()) : '';
  if (!needle) return text;
  const hay = text.split('').map((c) => fold(c)).join('');
  if (hay.length !== text.length) return text; // composed characters changed length: skip marking
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    parts.push(text.slice(from, at), <mark key={`${key}-${at}`}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}

function inline(text: string, keyPrefix: string, highlight?: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return <code key={key} className="inline">{part.slice(1, -1)}</code>;
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <strong key={key}>{marked(part.slice(1, -1), highlight, key)}</strong>;
    if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) return <em key={key}>{marked(part.slice(1, -1), highlight, key)}</em>;
    return <Fragment key={key}>{marked(part, highlight, key)}</Fragment>;
  });
}

export function FormattedText({ text, highlight }: { text: string; highlight?: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const last = i === lines.length - 1;
        if (line.startsWith('> ')) {
          return <blockquote key={i} className="fmt">{inline(line.slice(2), `q${i}`, highlight)}</blockquote>;
        }
        return (
          <Fragment key={i}>
            {inline(line, `l${i}`, highlight)}
            {!last && '\n'}
          </Fragment>
        );
      })}
    </>
  );
}
