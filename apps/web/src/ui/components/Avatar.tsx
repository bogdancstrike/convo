import { useProfile } from './ProfileContext';
import { AVATAR_COLORS } from '../theme/tokens';
import { Icon } from './Icon';

/**
 * Initials avatar with a stable, contrast-checked ground derived from the ID (profile photos need
 * E2EE profile keys, a later feature). Groups show a people icon.
 */
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

export function initials(name: string): string {
  const words = name.replace(/^@/, '').trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : (words[0] ?? '?').slice(0, 1);
  return letters.toUpperCase();
}

export function Avatar({ id, name, size = 48, group = false }: { id: string; name: string; size?: number; group?: boolean }) {
  const profile = useProfile(id);
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ background: avatarColor(id), width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {!group && profile?.photo ? <img src={profile.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : group ? <Icon name="group" size={Math.round(size * 0.5)} /> : initials(name)}
    </span>
  );
}
