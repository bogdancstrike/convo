import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { EnclaveApi } from '../api/enclaveApi';
import { decryptAttachment, encryptAttachment } from '../crypto/attachmentCipher';
import { sha256, toBase64Url } from '../lib/bytes';
import { MULTIPART_THRESHOLD, uploadAttachment, type UploadResume } from './attachments';

const PART = 5 * 1024 * 1024;

function plaintext(n: number, fill = 7): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = (i * 31 + fill) & 0xff;
  return data;
}

/** In-memory multipart server + storage behind fetch. */
function fakeServer(options: { failPartOnce?: number; forget?: boolean } = {}) {
  const stored = new Map<number, Uint8Array>();
  const puts: number[] = [];
  let failed = false;
  let size = 0;
  const api = {
    attachmentMultipart: vi.fn(async (s: number) => { size = s; return { attachmentId: 'att-1', uploadSecret: 'sec', partSize: PART, partCount: Math.ceil(s / PART), expiresAt: '' }; }),
    attachmentUploadedParts: vi.fn(async () => {
      if (options.forget) throw new ApiError(404, 'NOT_FOUND', 'upload unknown');
      return { uploadedParts: [...stored.keys()] };
    }),
    attachmentParts: vi.fn(async (_id: string, _s: string, parts: number[]) => parts.map((n) => ({ partNumber: n, url: `https://s3/part/${n}` }))),
    attachmentComplete: vi.fn(async () => undefined),
    attachmentUploadForm: vi.fn(),
  } as unknown as EnclaveApi;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const n = Number(url.split('/').pop());
    if (options.failPartOnce === n && !failed) { failed = true; throw new TypeError('network down'); }
    puts.push(n);
    stored.set(n, new Uint8Array(init.body as Uint8Array));
    return new Response(null, { status: 200 });
  }));
  const blob = () => {
    const out = new Uint8Array(size);
    for (const [n, part] of stored) out.set(part, (n - 1) * PART);
    return out;
  };
  return { api, puts, stored, blob };
}

afterEach(() => vi.unstubAllGlobals());

describe('resumable attachment uploads', () => {
  it('re-encrypts identically from a seed', async () => {
    const data = plaintext(200_000);
    const first = await encryptAttachment(data);
    const again = await encryptAttachment(data, first.seed);
    expect(again.digest).toBe(first.digest);
    expect(toBase64Url(again.blob)).toBe(toBase64Url(first.blob));
  });

  it('resumes after a failure, uploading only the missing parts, and the result decrypts', async () => {
    const data = plaintext(MULTIPART_THRESHOLD + 3 * PART);
    const server = fakeServer({ failPartOnce: 2 });
    let saved: UploadResume | undefined;
    const file = { data, contentType: 'application/octet-stream', fileName: 'big.bin' };
    // Part 2's first PUT fails (network); it is retried with backoff within the same attempt.
    await expect(uploadAttachment(server.api, file, {}, { onResume: (r) => { saved = r; } })).resolves.toBeDefined();
    expect(saved).toBeDefined();
    const partCount = saved!.partCount;
    expect(server.puts.length).toBe(partCount); // the failed attempt was retried, not counted

    // Simulate a restart mid-way: storage has parts 1..2 only; resume uploads the rest.
    for (let n = 3; n <= partCount; n++) server.stored.delete(n);
    server.puts.length = 0;
    const pointer = await uploadAttachment(server.api, file, {}, { resume: saved });
    expect(server.puts).toEqual(Array.from({ length: partCount - 2 }, (_, i) => i + 3));
    expect(server.api.attachmentMultipart).toHaveBeenCalledTimes(1);
    const blob = server.blob() as Uint8Array<ArrayBuffer>;
    expect(toBase64Url(await sha256(blob))).toBe(pointer.digest);
    const decrypted = await decryptAttachment(blob, pointer.key, pointer.digest, 200 * 1024 * 1024);
    expect(decrypted.length).toBe(data.length);
    expect(decrypted[12345]).toBe(data[12345]);
  });

  it('never reuses a seed for different bytes, and restarts an expired session with a fresh key', async () => {
    const data = plaintext(MULTIPART_THRESHOLD + PART);
    const server = fakeServer();
    let saved: UploadResume | undefined;
    const first = await uploadAttachment(server.api, { data, contentType: 'x', fileName: 'a' }, {}, { onResume: (r) => { saved = r; } });

    const other = fakeServer();
    const changed = await uploadAttachment(other.api, { data: plaintext(data.length, 9), contentType: 'x', fileName: 'a' }, {}, { resume: saved });
    expect(changed.key).not.toBe(first.key);
    expect(other.api.attachmentUploadedParts).not.toHaveBeenCalled();

    const expired = fakeServer({ forget: true });
    const restarted = await uploadAttachment(expired.api, { data, contentType: 'x', fileName: 'a' }, {}, { resume: saved });
    expect(restarted.key).not.toBe(first.key);
    expect(expired.api.attachmentMultipart).toHaveBeenCalledTimes(1);
  });
});
