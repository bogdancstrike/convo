import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, COLORS, NAME_COLORS, TEXT_PAIRS, UI_PAIRS, type Mode } from './tokens';

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each<Mode>(['light', 'dark'])('%s appearance contrast', (mode) => {
  const c = COLORS[mode];
  it.each(TEXT_PAIRS)('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(UI_PAIRS)('%s on %s ≥ 3:1', (fg, bg) => {
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(3);
  });
  it.each([...NAME_COLORS[mode]])('sender name %s on incoming bubble ≥ 4.5:1', (color) => {
    expect(contrast(color, c.bubbleIn)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('avatar grounds', () => {
  it.each([...AVATAR_COLORS])('white initials on %s ≥ 4.5:1', (bg) => {
    expect(contrast('#FFFFFF', bg)).toBeGreaterThanOrEqual(4.5);
  });
});
