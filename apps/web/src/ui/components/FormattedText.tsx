import { LINK_PATTERN, trimLink } from '../../lib/links';
import { ExternalLink } from './ExternalLink';
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

/** Highlights `@Label` tokens of structured mentions (labels come from the message's mention IDs). */
function withMentions(text: string, highlight: string | undefined, key: string, mentions: string[]): ReactNode {
  if (!mentions.length) return marked(text, highlight, key);
  const pattern = new RegExp(`(${mentions.map((m) => `@${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|')})`, 'gu');
  return text.split(pattern).map((part, i) => mentions.includes(part.slice(1)) && part.startsWith('@')
    ? <span key={`${key}-m${i}`} className="mention" data-testid="mention">{part}</span>
    : <Fragment key={`${key}-m${i}`}>{marked(part, highlight, `${key}-m${i}`)}</Fragment>);
}

function linked(text: string, highlight: string | undefined, key: string, mentions: string[] = []): ReactNode {
  return text.split(LINK_PATTERN).map((part, i) => {
    if (!/^(https?:\/\/|www\.)/i.test(part)) return <Fragment key={i}>{withMentions(part, highlight, `${key}-${i}`, mentions)}</Fragment>;
    const link = trimLink(part);
    return <Fragment key={i}><ExternalLink href={link}>{marked(link, highlight, `${key}-${i}`)}</ExternalLink>{part.slice(link.length)}</Fragment>;
  });
}

function inline(text: string, keyPrefix: string, highlight?: string, mentions: string[] = []): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return <code key={key} className="inline">{part.slice(1, -1)}</code>;
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <strong key={key}>{linked(part.slice(1, -1), highlight, key, mentions)}</strong>;
    if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) return <em key={key}>{linked(part.slice(1, -1), highlight, key, mentions)}</em>;
    return <Fragment key={key}>{linked(part, highlight, key, mentions)}</Fragment>;
  });
}

export function FormattedText({ text, highlight, mentions = [] }: { text: string; highlight?: string; mentions?: string[] }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const last = i === lines.length - 1;
        if (line.startsWith('> ')) {
          return <blockquote key={i} className="fmt">{inline(line.slice(2), `q${i}`, highlight, mentions)}</blockquote>;
        }
        return (
          <Fragment key={i}>
            {inline(line, `l${i}`, highlight, mentions)}
            {!last && '\n'}
          </Fragment>
        );
      })}
    </>
  );
}
