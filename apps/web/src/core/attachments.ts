import { NetworkError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import { ApiError } from '../api/errors';
import { decryptAttachment, encryptAttachment, type AttachmentSeed, type EncryptedAttachment } from '../crypto/attachmentCipher';
import { sha256, toBase64Url } from '../lib/bytes';
import type { AttachmentPointer } from '../crypto/content';

/**
 * Attachment transfer (specs §7, UI.md §5.3; task FEAT-01): local preparation (metadata
 * stripping), encryption, presigned upload, and verified download/decryption.
 */

/** Maximum plaintext attachment size (specs §26.3). */
export let MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export function configureAttachmentLimit(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > 1024 * 1024 * 1024) throw new Error('invalid attachment policy');
  MAX_ATTACHMENT_BYTES = bytes;
}
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
  // Tiny preview (≤ 32 px) carried inside the E2EE pointer; shown blurred until the photo loads.
  const thumbScale = 32 / Math.max(width, height);
  const thumb = document.createElement('canvas');
  thumb.width = Math.max(1, Math.round(width * thumbScale)); thumb.height = Math.max(1, Math.round(height * thumbScale));
  thumb.getContext('2d')!.drawImage(bitmap, 0, 0, thumb.width, thumb.height);
  bitmap.close();
  const thumbBlob = await new Promise<Blob | null>((resolve) => thumb.toBlob(resolve, 'image/jpeg', 0.6));
  const thumbnail = thumbBlob ? toBase64Url(new Uint8Array(await thumbBlob.arrayBuffer())) : undefined;
  const outType = contentType === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), outType, 0.9),
  );
  const name = outType === 'image/jpeg' ? fileName.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg' : fileName;
  return { data: new Uint8Array(await blob.arrayBuffer()), contentType: outType, fileName: name, width, height, thumbnail };
}

/** Encrypted blobs above this size are uploaded in resumable parts (FEAT-01). */
export const MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const PART_ATTEMPTS = 3;
const PART_BATCH = 16;

/**
 * Progress of a resumable upload, persisted with an offline-queued file so a later attempt (even
 * after a restart) re-creates the identical ciphertext and uploads only the missing parts. Holds
 * the attachment key: keep it only in the encrypted local store.
 */
export interface UploadResume {
  seed: AttachmentSeed;
  /** SHA-256 of the plaintext the seed belongs to (never reuse the seed for other bytes). */
  plaintextDigest: string;
  attachmentId: string;
  uploadSecret: string;
  partSize: number;
  partCount: number;
}

/** Options for {@link uploadAttachment}. */
export interface UploadOptions {
  /** Saved progress from an earlier attempt. */
  resume?: UploadResume;
  /** Called whenever there is progress worth saving (before any part is sent). */
  onResume?: (resume: UploadResume) => Promise<void> | void;
  /** Fraction of the encrypted bytes stored so far (0–1). */
  onProgress?: (fraction: number) => void;
}

/** Encrypts and uploads a prepared file; returns the pointer to embed in E2EE content. */
export async function uploadAttachment(
  api: EnclaveApi,
  file: PreparedFile,
  extra: Pick<AttachmentPointer, 'voiceNote' | 'durationMs'> = {},
  options: UploadOptions = {},
): Promise<AttachmentPointer> {
  const plaintextDigest = toBase64Url(await sha256(file.data));
  const resume = options.resume?.plaintextDigest === plaintextDigest ? options.resume : undefined;
  let encrypted = await encryptAttachment(file.data, resume?.seed);
  let attachmentId: string;
  if (encrypted.blob.length > MULTIPART_THRESHOLD) {
    ({ attachmentId, encrypted } = await uploadParts(api, file.data, encrypted, plaintextDigest, resume, options));
  } else {
    const form = await api.attachmentUploadForm(encrypted.blob.length);
    await put(form.uploadUrl, encrypted.blob);
    attachmentId = form.attachmentId;
  }
  options.onProgress?.(1);
  return {
    attachmentId,
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

/** One PUT of ciphertext to a presigned URL; network failures become {@link NetworkError}. */
async function put(url: string, body: Uint8Array<ArrayBuffer>): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': 'application/octet-stream' }, credentials: 'omit', cache: 'no-store' });
  } catch (error) {
    throw new NetworkError(error);
  }
  if (response.status >= 500 || response.status === 429) throw new NetworkError(new Error(`storage unavailable: ${response.status}`));
  if (!response.ok) throw new Error(`upload failed: ${response.status}`);
}

/**
 * Multipart upload: starts (or resumes) a session, uploads the parts the server does not have yet
 * (each retried briefly), then completes. A session the server no longer knows (expired) is
 * restarted from scratch with a fresh key.
 */
async function uploadParts(api: EnclaveApi, plaintext: Uint8Array<ArrayBuffer>, encrypted: EncryptedAttachment, plaintextDigest: string,
  resume: UploadResume | undefined, options: UploadOptions): Promise<{ attachmentId: string; encrypted: EncryptedAttachment }> {
  let session = resume;
  let uploaded = new Set<number>();
  if (session) {
    try {
      uploaded = new Set((await api.attachmentUploadedParts(session.attachmentId, session.uploadSecret)).uploadedParts);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
      // Expired or completed elsewhere: start over with a fresh key (never reuse the old seed).
      return uploadParts(api, plaintext, await encryptAttachment(plaintext), plaintextDigest, undefined, options);
    }
  }
  if (!session) {
    const form = await api.attachmentMultipart(encrypted.blob.length);
    session = { seed: encrypted.seed, plaintextDigest, attachmentId: form.attachmentId, uploadSecret: form.uploadSecret, partSize: form.partSize, partCount: form.partCount };
    await options.onResume?.(session);
  }
  const { attachmentId, uploadSecret, partSize, partCount } = session;
  const missing = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !uploaded.has(n));
  let done = partCount - missing.length;
  options.onProgress?.(done / partCount);
  for (let i = 0; i < missing.length; i += PART_BATCH) {
    const urls = await api.attachmentParts(attachmentId, uploadSecret, missing.slice(i, i + PART_BATCH));
    for (const { partNumber, url } of urls) {
      const body = encrypted.blob.subarray((partNumber - 1) * partSize, Math.min(encrypted.blob.length, partNumber * partSize));
      for (let attempt = 1; ; attempt++) {
        try { await put(url, body.slice()); break; } catch (error) {
          if (!(error instanceof NetworkError) || attempt >= PART_ATTEMPTS) throw error;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        }
      }
      options.onProgress?.(++done / partCount);
    }
  }
  await api.attachmentComplete(attachmentId, uploadSecret);
  return { attachmentId, encrypted };
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
    const plain = await decryptAttachment(new Uint8Array(await response.arrayBuffer()), pointer.key, pointer.digest, Math.max(MAX_ATTACHMENT_BYTES, 100 * 1024 * 1024));
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
