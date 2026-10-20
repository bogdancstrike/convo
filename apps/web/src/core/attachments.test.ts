import { afterEach, expect, it } from 'vitest';
import { configureAttachmentLimit, MAX_ATTACHMENT_BYTES, prepareFile } from './attachments';
afterEach(() => configureAttachmentLimit(100 * 1024 * 1024));
it('uses the advertised deployment limit before reading a selected file', async () => {
  configureAttachmentLimit(1024 * 1024);
  const oversized = { size: 1024 * 1024 + 1, name: 'large.bin' } as File;
  await expect(prepareFile(oversized)).rejects.toMatchObject({ reason: 'too-large' });
  expect(MAX_ATTACHMENT_BYTES).toBe(1024 * 1024);
  const allowed = new File([new Uint8Array(1024 * 1024)], 'boundary.bin');
  await expect(prepareFile(allowed)).resolves.toMatchObject({ fileName: 'boundary.bin' });
});
it('rejects malformed policy values instead of removing the limit', () => {
  for (const value of [0, -1, Infinity, NaN, 1.5, 2 ** 40]) expect(() => configureAttachmentLimit(value)).toThrow();
});
