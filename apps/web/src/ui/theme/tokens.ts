/**
 * Design tokens — the single source of truth for colour, type, radius and elevation.
 *
 * Brand palette (product decision):
 *   Deep Navy #17324D · Ocean Blue #2596BE · Soft Cyan #8BD3E2 · Warm Amber #F2B66D · Ice White #F4F8FA
 *
 * The interface itself is neutral grey (messenger conventions); the palette provides accents. Ocean
 * Blue carries white text at only 3.4:1, so solid buttons use darker `OCEAN[700]` (6.1:1) in light
 * mode and Soft Cyan with near-black text in dark mode.
 * Every text/background pair is checked by `contrast.test.ts` (WCAG 2.x: 4.5:1 body text, 3:1 UI).
 * Components read only the CSS custom properties produced by {@link cssVariables}.
 */

export const BRAND = {
  navy: '#17324D',
  ocean: '#2596BE',
  cyan: '#8BD3E2',
  amber: '#F2B66D',
  ice: '#F4F8FA',
} as const;

/** Ocean Blue scale (500 = brand). */
export const OCEAN = {
  50: '#EAF5F9',
  100: '#D4ECF4',
  200: '#A9D8E9',
  300: '#6FBFDB',
  400: '#46A9CD',
  500: '#2596BE',
  600: '#1E7DA0',
  700: '#18657F',
  800: '#134F64',
  900: '#0F3B4B',
} as const;

/** Navy-tinted neutrals for the dark appearance (100 = lightest). */
export const NAVY = {
  950: '#0A1826',
  900: '#0E1F30',
  850: '#12283D',
  800: '#17324D',
  750: '#1C3B58',
  700: '#224564',
  650: '#28506F',
  600: '#2F5A7C',
  400: '#7F9DB4',
  300: '#A9C1D1',
  200: '#CBDAE4',
  100: '#F4F8FA',
} as const;

/** Cool neutrals for the light appearance. */
export const SLATE = {
  0: '#FFFFFF',
  50: '#F4F8FA',
  100: '#EAF1F5',
  200: '#D9E4EB',
  300: '#BCCBD6',
  500: '#5A6F82',
  600: '#4A6278',
  900: '#17324D',
} as const;

export const AMBER = {
  100: '#FCEBD3',
  300: '#F7CF9A',
  500: '#F2B66D',
  800: '#6B4310',
} as const;

export const FONT = {
  family: "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
} as const;

export type Mode = 'light' | 'dark';

/** Semantic colour roles used by the stylesheet. */
export interface ColorRoles {
  canvas: string;
  panel: string;
  panelRaised: string;
  hover: string;
  selected: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textOnAccent: string;
  accent: string;
  accentText: string;
  actionFill: string;
  actionText: string;
  rail: string;
  railText: string;
  railActive: string;
  railActiveText: string;
  bubbleOut: string;
  bubbleIn: string;
  bubbleMeta: string;
  wallpaper: string;
  wallpaperPattern: string;
  badge: string;
  badgeText: string;
  tickRead: string;
  warningBg: string;
  warningText: string;
  danger: string;
  dangerText: string;
  focus: string;
  chip: string;
  chipText: string;
  chipActive: string;
  chipActiveText: string;
}

/**
 * Neutral greys carry the interface (messenger-style), the brand palette is used for accents:
 * darker Ocean for actions, Soft Cyan on dark surfaces, Warm Amber for attention.
 */
export const GREY = {
  light: { canvas: '#F5F6F7', panel: '#FFFFFF', hover: '#F2F3F5', selected: '#EAECEF', border: '#E4E7EA', text: '#111B21', muted: '#54656F', rail: '#F0F2F5', railActive: '#DDE1E5' },
  dark: { canvas: '#161717', panel: '#161717', raised: '#232626', hover: '#202323', selected: '#2E2F2F', border: '#2A2C2C', text: '#E9EDEF', muted: '#A5A8AA', rail: '#1D1F1F', wallpaper: '#101111' },
} as const;

export const COLORS: Record<Mode, ColorRoles> = {
  light: {
    canvas: GREY.light.canvas,
    panel: GREY.light.panel,
    panelRaised: GREY.light.panel,
    hover: GREY.light.hover,
    selected: GREY.light.selected,
    border: GREY.light.border,
    textPrimary: GREY.light.text,
    textSecondary: GREY.light.muted,
    textOnAccent: '#FFFFFF',
    accent: BRAND.ocean,
    accentText: OCEAN[700],
    actionFill: OCEAN[700],
    actionText: '#FFFFFF',
    rail: GREY.light.rail,
    railText: GREY.light.muted,
    railActive: GREY.light.railActive,
    railActiveText: BRAND.navy,
    bubbleOut: '#DCEEF3',
    bubbleIn: '#FFFFFF',
    bubbleMeta: GREY.light.muted,
    wallpaper: '#EFEFEC',
    wallpaperPattern: 'rgba(17, 27, 33, 0.05)',
    badge: OCEAN[700],
    badgeText: '#FFFFFF',
    tickRead: OCEAN[600],
    warningBg: AMBER[100],
    warningText: AMBER[800],
    danger: '#C62828',
    dangerText: '#B42318',
    focus: BRAND.ocean,
    chip: GREY.light.hover,
    chipText: GREY.light.muted,
    chipActive: '#DCEEF3',
    chipActiveText: OCEAN[800],
  },
  dark: {
    canvas: GREY.dark.canvas,
    panel: GREY.dark.panel,
    panelRaised: GREY.dark.raised,
    hover: GREY.dark.hover,
    selected: GREY.dark.selected,
    border: GREY.dark.border,
    textPrimary: GREY.dark.text,
    textSecondary: GREY.dark.muted,
    textOnAccent: '#0B1A24',
    accent: BRAND.cyan,
    accentText: BRAND.cyan,
    actionFill: BRAND.cyan,
    actionText: '#0B1A24',
    rail: GREY.dark.rail,
    railText: GREY.dark.muted,
    railActive: GREY.dark.selected,
    railActiveText: GREY.dark.text,
    bubbleOut: OCEAN[800],
    bubbleIn: GREY.dark.raised,
    bubbleMeta: '#B4C3C9',
    wallpaper: GREY.dark.wallpaper,
    wallpaperPattern: 'rgba(233, 237, 239, 0.035)',
    badge: BRAND.cyan,
    badgeText: '#0B1A24',
    tickRead: BRAND.cyan,
    warningBg: '#3A2F1C',
    warningText: BRAND.amber,
    danger: '#F15C6D',
    dangerText: '#FF8A8A',
    focus: BRAND.cyan,
    chip: GREY.dark.selected,
    chipText: GREY.dark.muted,
    chipActive: '#12323F',
    chipActiveText: BRAND.cyan,
  },
};

/** Avatar grounds; each carries white initials at ≥ 4.5:1 (asserted in `contrast.test.ts`). */
export const AVATAR_COLORS = ['#18657F', '#17324D', '#1E7DA0', '#5B4A8B', '#8A4A23', '#2F6B4F', '#7A3E5C', '#4A6278'] as const;

/** Sender-name colours in group bubbles (distinct per author, readable on incoming bubbles). */
export const NAME_COLORS: Record<Mode, readonly string[]> = {
  light: ['#18657F', '#7A3E5C', '#2F6B4F', '#8A4A23', '#5B4A8B', '#1E5A8A', '#6B5A14', '#A03A3A'],
  dark: ['#8BD3E2', '#F2B66D', '#B9E4A0', '#F5A8C8', '#C8B6FF', '#9FD0FF', '#FFD38A', '#FF9F9F'],
};

/** Stable sender-name colour index for an account. */
export function nameColorIndex(accountId: string): number {
  let hash = 7;
  for (let i = 0; i < accountId.length; i++) hash = (hash * 33 + accountId.charCodeAt(i)) | 0;
  return Math.abs(hash) % NAME_COLORS.light.length;
}

/** Text/background pairs that must reach 4.5:1 (body text) in each appearance. */
export const TEXT_PAIRS: [keyof ColorRoles, keyof ColorRoles][] = [
  ['textPrimary', 'canvas'],
  ['textPrimary', 'panel'],
  ['textPrimary', 'hover'],
  ['textPrimary', 'selected'],
  ['textPrimary', 'bubbleOut'],
  ['textPrimary', 'bubbleIn'],
  ['textSecondary', 'panel'],
  ['textSecondary', 'canvas'],
  ['bubbleMeta', 'bubbleOut'],
  ['bubbleMeta', 'bubbleIn'],
  ['accentText', 'panel'],
  ['actionText', 'actionFill'],
  ['badgeText', 'badge'],
  ['railText', 'rail'],
  ['railActiveText', 'railActive'],
  ['warningText', 'warningBg'],
  ['dangerText', 'panel'],
  ['textSecondary', 'hover'],
  ['textPrimary', 'panelRaised'],
  ['railActiveText', 'rail'],
  ['chipText', 'chip'],
  ['chipActiveText', 'chipActive'],
];

/** Non-text UI pairs that must reach 3:1 (focus ring, read ticks). */
export const UI_PAIRS: [keyof ColorRoles, keyof ColorRoles][] = [
  ['focus', 'panel'],
  ['tickRead', 'bubbleOut'],
];

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** CSS custom properties for an appearance (`--c-<role>`). */
export function cssVariables(mode: Mode): Record<string, string> {
  const vars: Record<string, string> = { '--font-family': FONT.family, '--font-mono': FONT.mono };
  for (const [role, value] of Object.entries(COLORS[mode])) vars[`--c-${kebab(role)}`] = value;
  NAME_COLORS[mode].forEach((value, i) => (vars[`--c-name-${i}`] = value));
  return vars;
}

/** Resolves the effective appearance for a user preference. */
export function resolveMode(preference: 'system' | Mode): Mode {
  if (preference !== 'system') return preference;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Applies an appearance to the document root. */
export function applyTheme(preference: 'system' | Mode): Mode {
  const mode = resolveMode(preference);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(cssVariables(mode))) root.style.setProperty(name, value);
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  return mode;
}
