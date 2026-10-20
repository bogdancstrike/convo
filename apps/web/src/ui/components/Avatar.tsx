/**
 * Initial-based avatar with a stable color derived from the account ID (UI.md §3: stable
 * fallback colors; profile photos require profile keys, a later feature).
 */
const COLORS = ['#086b58', '#2f5fa7', '#8a4fb0', '#b5532e', '#3f7d3a', '#9b3a5a', '#56607a', '#7a6a1f'];

export function Avatar({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const color = COLORS[Math.abs(hash) % COLORS.length];
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span className="avatar" aria-hidden="true" style={{ background: color, width: size, height: size }}>
      {initial}
    </span>
  );
}
