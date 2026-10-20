/** Private profile data shared only through encrypted conversations and own-account history. */
export interface UserProfile { accountId: string; status: string; photo?: string; updatedAt: number; }
export function isProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as UserProfile;
  return typeof p.accountId === 'string' && typeof p.status === 'string' && p.status.length <= 280 && Number.isFinite(p.updatedAt) &&
    (p.photo === undefined || (typeof p.photo === 'string' && p.photo.length <= 48000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(p.photo)));
}

/** Re-encoding crops to a square and removes EXIF; SVG and active content are never accepted. */
export async function prepareProfilePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('unsupported photo');
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 192;
    const context = canvas.getContext('2d'); if (!context) throw new Error('canvas unavailable');
    const side = Math.min(image.width, image.height);
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 192, 192);
    const result = canvas.toDataURL('image/jpeg', .75);
    if (result.length > 48000) throw new Error('photo too large');
    return result;
  } finally { image.close(); }
}
