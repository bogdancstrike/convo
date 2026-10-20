import type { AttachmentPointer } from '../crypto/content';
import { isInlineImage } from './attachments';

/**
 * Media auto-download preferences (device-local, never synced).
 *
 * "Download" means fetching and decrypting into memory/private storage so the item is ready to
 * view. It never writes a plaintext copy anywhere: browsers save files only on an explicit action,
 * and Android exports to the shared gallery only when the separate `saveToGallery` switch is on.
 */
export type MediaKind = 'photos' | 'audio' | 'videos' | 'documents';
export type NetworkKind = 'wifi' | 'cellular' | 'roaming';
export type AutoDownloadSettings = Record<NetworkKind, MediaKind[]>;

export const MEDIA_KINDS: readonly MediaKind[] = ['photos', 'audio', 'videos', 'documents'];
export const NETWORK_KINDS: readonly NetworkKind[] = ['wifi', 'cellular', 'roaming'];

/** Matches the behaviour before preferences existed: photos and voice notes load automatically. */
export const DEFAULT_AUTO_DOWNLOAD: AutoDownloadSettings = { wifi: ['photos', 'audio'], cellular: ['photos', 'audio'], roaming: [] };

/**
 * Upper bound for automatic video/document prefetch. Larger items always wait for a tap so a
 * chat full of big files cannot exhaust memory or a metered plan.
 */
export const AUTO_PREFETCH_MAX_BYTES = 16 * 1024 * 1024;

export function mediaKindOf(pointer: Pick<AttachmentPointer, 'contentType' | 'voiceNote'>): MediaKind {
  if (isInlineImage(pointer as AttachmentPointer)) return 'photos';
  const type = pointer.contentType.toLowerCase();
  if (pointer.voiceNote || type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'videos';
  return 'documents';
}

/** Own media is always shown; other media follows the rule for the current network. */
export function shouldAutoDownload(settings: AutoDownloadSettings, pointer: AttachmentPointer, network: NetworkKind, own: boolean): boolean {
  const kind = mediaKindOf(pointer);
  if ((kind === 'videos' || kind === 'documents') && pointer.size > AUTO_PREFETCH_MAX_BYTES) return false;
  return own || settings[network].includes(kind);
}

/** Drops unknown values from untrusted input (e.g. the native bridge) and removes duplicates. */
export function sanitizeAutoDownload(value: unknown): AutoDownloadSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result = {} as AutoDownloadSettings;
  for (const network of NETWORK_KINDS) {
    const list = source[network];
    if (!Array.isArray(list)) return undefined;
    result[network] = MEDIA_KINDS.filter((kind) => list.includes(kind));
  }
  return result;
}

/** Browsers cannot detect roaming; the Network Information API (where available) flags cellular. */
export function browserNetwork(): NetworkKind {
  const connection = (globalThis.navigator as Navigator & { connection?: { type?: string } } | undefined)?.connection;
  return connection?.type === 'cellular' ? 'cellular' : 'wifi';
}
