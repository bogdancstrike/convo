import type { EnclaveClient } from '../../core/client';
import type { AttachmentPointer } from '../../crypto/content';

const urls = new Map<string, Promise<string>>();
export function decryptMediaUrl(client: EnclaveClient, pointer: AttachmentPointer): Promise<string> {
  const key = `${client.accountId}/${pointer.attachmentId}`;
  let pending = urls.get(key);
  if (!pending) {
    pending = client.downloadAttachment(pointer).then((blob) => URL.createObjectURL(blob));
    urls.set(key, pending);
    void pending.catch(() => { if (urls.get(key) === pending) urls.delete(key); });
  }
  return pending;
}
/** Plaintext blobs live only in the current signed-in workspace. */
export function clearMediaUrls(): void {
  for (const pending of urls.values()) void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  urls.clear();
}
