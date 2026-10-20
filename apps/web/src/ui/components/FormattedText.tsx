import { Fragment, type ReactNode } from 'react';

/**
 * Safe basic formatting (UI.md §5.3): `*bold*`, `_italic_`, `` `code` `` and `> quote` lines,
 * rendered as React elements — never via innerHTML — so message text cannot inject markup.
 * URLs are shown as text, not auto-linked: opening a link must be an explicit action with the
 * destination visible (link handling is a later feature).
 */
const INLINE = /(`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return <code key={key} className="inline">{part.slice(1, -1)}</code>;
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <strong key={key}>{part.slice(1, -1)}</strong>;
    if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) return <em key={key}>{part.slice(1, -1)}</em>;
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function FormattedText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const last = i === lines.length - 1;
        if (line.startsWith('> ')) {
          return <blockquote key={i} className="fmt">{inline(line.slice(2), `q${i}`)}</blockquote>;
        }
        return (
          <Fragment key={i}>
            {inline(line, `l${i}`)}
            {!last && '\n'}
          </Fragment>
        );
      })}
    </>
  );
}
