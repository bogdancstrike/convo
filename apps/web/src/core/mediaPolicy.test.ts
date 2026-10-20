import { expect, it } from 'vitest';
import type { AttachmentPointer } from '../crypto/content';
import { AUTO_PREFETCH_MAX_BYTES, type AutoDownloadSettings, DEFAULT_AUTO_DOWNLOAD, mediaKindOf, sanitizeAutoDownload, shouldAutoDownload } from './mediaPolicy';

const pointer = (contentType: string, size = 1000, voiceNote?: boolean) => ({ attachmentId: '00000000-0000-0000-0000-000000000000', key: '', digest: '', size, contentType, voiceNote }) as AttachmentPointer;

it('classifies media and keeps the previous photo/voice behaviour by default', () => {
  expect([pointer('image/png'), pointer('audio/ogg'), pointer('audio/webm', 1, true), pointer('video/mp4'), pointer('application/pdf'), pointer('image/svg+xml')].map(mediaKindOf))
    .toEqual(['photos', 'audio', 'audio', 'videos', 'documents', 'documents']);
  expect(shouldAutoDownload(DEFAULT_AUTO_DOWNLOAD, pointer('image/jpeg'), 'wifi', false)).toBe(true);
  expect(shouldAutoDownload(DEFAULT_AUTO_DOWNLOAD, pointer('image/jpeg'), 'roaming', false)).toBe(false);
  expect(shouldAutoDownload(DEFAULT_AUTO_DOWNLOAD, pointer('video/mp4'), 'wifi', false)).toBe(false);
  expect(shouldAutoDownload(DEFAULT_AUTO_DOWNLOAD, pointer('image/jpeg'), 'roaming', true)).toBe(true);
});

it('never prefetches large videos or documents automatically', () => {
  const rules: AutoDownloadSettings = { wifi: ['photos', 'audio', 'videos', 'documents'], cellular: [], roaming: [] };
  expect(shouldAutoDownload(rules, pointer('video/mp4', AUTO_PREFETCH_MAX_BYTES), 'wifi', false)).toBe(true);
  expect(shouldAutoDownload(rules, pointer('video/mp4', AUTO_PREFETCH_MAX_BYTES + 1), 'wifi', true)).toBe(false);
});

it('sanitizes untrusted preference input', () => {
  expect(sanitizeAutoDownload({ wifi: ['videos', 'photos', 'photos', 'bogus'], cellular: [], roaming: ['audio'] }))
    .toEqual({ wifi: ['photos', 'videos'], cellular: [], roaming: ['audio'] });
  expect(sanitizeAutoDownload({ wifi: [] })).toBeUndefined();
  expect(sanitizeAutoDownload(null)).toBeUndefined();
});
