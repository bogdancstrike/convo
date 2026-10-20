import { NetworkError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import { decryptAttachment, encryptAttachment } from '../crypto/attachmentCipher';
import { toBase64Url } from '../lib/bytes';
import type { AttachmentPointer } from '../crypto/content';

/**
 * Attachment transfer (specs §7, UI.md §5.3; task FEAT-01): local preparation (metadata
 * stripping), encryption, presigned upload, and verified download/decryption.
 */

/** Maximum plaintext attachment size (specs §26.3). */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
/** Longest image side after re-encoding. */
const MAX_IMAGE_SIDE = 4096;
/** Image types re-encoded to drop EXIF/XMP metadata (including location). */
const REENCODED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** A file ready for encryption. */
export interface PreparedFile {
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
  fileName: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** base64url JPEG poster (videos). */
  thumbnail?: string;
}

/** Video containers/codecs we offer inline playback for (browser support still decides). */
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'] as const;
const THUMBNAIL_SIDE = 320;

/** Raised for files the user must change (too large, unreadable). */
export class AttachmentRejectedError extends Error {
  constructor(readonly reason: 'too-large' | 'unreadable', readonly fileName: string) {
    super(reason);
    this.name = 'AttachmentRejectedError';
  }
}

/**
 * Reads a user-selected file. JPEG/PNG/WebP images are decoded and re-encoded through a canvas,
 * which removes EXIF metadata such as GPS location by default (specs §25.1) and bounds pixel
 * dimensions. Other files are sent byte-for-byte.
 */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentRejectedError('too-large', file.name);
  const contentType = file.type || 'application/octet-stream';
  const fileName = file.name.slice(0, 255) || 'file';
  if (REENCODED_IMAGES.has(contentType) && typeof createImageBitmap === 'function') {
    try {
      return await reencodeImage(file, contentType, fileName);
    } catch {
      throw new AttachmentRejectedError('unreadable', file.name);
    }
  }
  const data = new Uint8Array(await file.arrayBuffer());
  if ((VIDEO_TYPES as readonly string[]).includes(contentType)) {
    // Metadata/poster are best effort: an undecodable video is still sent as a file.
    const info = await videoInfo(file).catch(() => undefined);
    return { data, contentType, fileName, ...info };
  }
  return { data, contentType, fileName };
}

/**
 * Reads duration and dimensions and captures a poster frame of a local video file. Runs entirely
 * in the browser (nothing is uploaded unencrypted).
 */
export async function videoInfo(file: Blob): Promise<Pick<PreparedFile, 'width' | 'height' | 'durationMs' | 'thumbnail'>> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('undecodable video'));
      setTimeout(() => reject(new Error('video metadata timeout')), 8000);
    });
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined;
    // Seek slightly in to avoid black first frames.
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = Math.min(0.5, (video.duration || 1) / 4);
      setTimeout(resolve, 1500);
    });
    const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(video.videoWidth, video.videoHeight, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
    const thumbnail = blob ? toBase64Url(new Uint8Array(await blob.arrayBuffer())) : undefined;
    return { width: video.videoWidth || undefined, height: video.videoHeight || undefined, durationMs, thumbnail };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function reencodeImage(file: File, contentType: string, fileName: string): Promise<PreparedFile> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const outType = contentType === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), outType, 0.9),
  );
  const name = outType === 'image/jpeg' ? fileName.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg' : fileName;
  return { data: new Uint8Array(await blob.arrayBuffer()), contentType: outType, fileName: name, width, height };
}

/** Encrypts and uploads a prepared file; returns the pointer to embed in E2EE content. */
export async function uploadAttachment(
  api: EnclaveApi,
  file: PreparedFile,
  extra: Pick<AttachmentPointer, 'voiceNote' | 'durationMs'> = {},
): Promise<AttachmentPointer> {
  const encrypted = await encryptAttachment(file.data);
  const form = await api.attachmentUploadForm(encrypted.blob.length);
  let response: Response;
  try {
    response = await fetch(form.uploadUrl, {
      method: 'PUT',
      body: encrypted.blob,
      headers: { 'Content-Type': 'application/octet-stream' },
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    throw new NetworkError(error);
  }
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
  return {
    attachmentId: form.attachmentId,
    key: encrypted.key,
    digest: encrypted.digest,
    size: file.data.length,
    contentType: file.contentType,
    fileName: file.fileName,
    width: file.width,
    height: file.height,
    durationMs: file.durationMs,
    thumbnail: file.thumbnail,
    ...extra,
  };
}

/** Download failure reasons shown to the user (UI.md §5.3). */
export type DownloadFailure = 'expired' | 'offline' | 'integrity';

/** Downloads, verifies and decrypts an attachment. */
export async function downloadAttachment(api: EnclaveApi, pointer: AttachmentPointer): Promise<Blob> {
  let url: string;
  try {
    url = (await api.attachmentDownload(pointer.attachmentId)).downloadUrl;
  } catch (error) {
    throw error instanceof NetworkError ? new AttachmentDownloadError('offline') : new AttachmentDownloadError('expired');
  }
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new AttachmentDownloadError('offline');
  }
  if (!response.ok) throw new AttachmentDownloadError(response.status === 404 ? 'expired' : 'offline');
  try {
    const plain = await decryptAttachment(new Uint8Array(await response.arrayBuffer()), pointer.key, pointer.digest);
    if (plain.length !== pointer.size) throw new Error('size mismatch');
    return new Blob([plain], { type: safeContentType(pointer.contentType) });
  } catch {
    throw new AttachmentDownloadError('integrity');
  }
}

/** Typed download error. */
export class AttachmentDownloadError extends Error {
  constructor(readonly reason: DownloadFailure) {
    super(reason);
    this.name = 'AttachmentDownloadError';
  }
}

/** Never let a sender-chosen type turn a download into active content (e.g. text/html). */
export function safeContentType(contentType: string): string {
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  return /^(image\/(jpeg|png|gif|webp)|audio\/(webm|ogg|mp4|mpeg|aac|wav)|video\/(mp4|webm|ogg|quicktime)|application\/pdf)$/.test(base)
    ? base
    : 'application/octet-stream';
}

/** True if the pointer is playable audio (voice notes and audio files). */
export function isAudio(pointer: AttachmentPointer): boolean {
  return safeContentType(pointer.contentType).startsWith('audio/');
}

/** True if the pointer is a video the browser can probably play inline. */
export function isVideo(pointer: AttachmentPointer): boolean {
  const type = safeContentType(pointer.contentType);
  if (!type.startsWith('video/')) return false;
  const probe = document.createElement('video');
  return probe.canPlayType(type) !== '';
}

/** True if the pointer can be shown inline as an image. */
export function isInlineImage(pointer: AttachmentPointer): boolean {
  return /^image\/(jpeg|png|gif|webp)$/.test(pointer.contentType);
}
