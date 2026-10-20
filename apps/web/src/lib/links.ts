/** Explicit HTTP(S) links only. Credentials and executable/custom schemes are never linked. */
export function normalizeLink(text: string): string | null {
  try {
    const url = new URL(text.startsWith('www.') ? `https://${text}` : text);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export const LINK_PATTERN = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+)/gi;
export const trimLink = (text: string) => text.replace(/[.,;!?)\]}]+$/, '');
export function linksIn(body: string): string[] {
  return [...new Set((body.match(LINK_PATTERN) ?? []).map(trimLink).filter((text) => normalizeLink(text)))];
}
