/**
 * Inline SVG icon set (bundled; no icon fonts or CDN requests). Decorative by default: pass a
 * `label` to expose it to assistive technology.
 */
const PATHS = {
  chats: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z',
  settings:
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 4.6-1.9 1.1.2 2.2-2.1 1.2-1.8-1.3-1.9.8-.6 2.1h-2.4l-.6-2.1-1.9-.8-1.8 1.3-2.1-1.2.2-2.2-1.9-1.1v-2.2l1.9-1.1-.2-2.2 2.1-1.2 1.8 1.3 1.9-.8.6-2.1h2.4l.6 2.1 1.9.8 1.8-1.3 2.1 1.2-.2 2.2 1.9 1.1z',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-4 16-4-7z',
  shield: 'M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z',
  back: 'M15 5l-7 7 7 7',
  note: 'M6 3h9l4 4v14H6zM14 3v5h5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, size = 22 }: { name: IconName; label?: string; size?: number }) {
  const stroked = name === 'plus' || name === 'back' || name === 'note';
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill={stroked ? 'none' : 'currentColor'}
      stroke={stroked ? 'currentColor' : 'none'}
      strokeWidth={stroked ? 2 : 0}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
