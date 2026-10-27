import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, until, type TestDevice } from '../test/fakeServer';
import type { ChatMessage } from './model';

// Real clients (key generation, Signal and MLS) are slow under the full parallel run.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Attachments (encrypted upload/download), view-once, voice notes, custom stickers, abuse reports,
 * acknowledgement requests, member policies and server directives between real clients.
 */
let server: FakeServer;
let ana: TestDevice;
let bob: TestDevice;
let anaId: string;
let bobId: string;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(7)]);
const dto = (d: TestDevice) => ({ accountId: d.account.accountId, username: d.account.username, displayName: d.account.displayName });
async function see(d: TestDevice, conversationId: string, predicate: (m: ChatMessage) => boolean): Promise<ChatMessage> {
  await until(async () => (await d.client.messages(conversationId)).some(predicate));
  return (await d.client.messages(conversationId)).find(predicate)!;
}
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

beforeEach(async () => {
  server = new FakeServer();
  ana = await server.enroll('ana', 'Ana Pop');
  bob = await server.enroll('bob', 'Bob Ionescu');
  anaId = ana.account.accountId; bobId = bob.account.accountId;
  await ana.client.start(); await bob.client.start();
  await until(() => ana.connection === 'online' && bob.connection === 'online');
  await ana.client.openConversation(dto(bob));
  await ana.client.sendText(bobId, 'hello');
  await see(bob, anaId, (m) => m.body === 'hello');
  await bob.client.acceptRequest(anaId);
});
afterEach(() => server.close(ana, bob));

describe('attachments', () => {
  it('a photo is encrypted before upload and decrypts to the same bytes for the recipient', async () => {
    await ana.client.sendAttachments(bobId, [new File([PNG], 'cat.png', { type: 'image/png' })], 'look');
    const received = await see(bob, anaId, (m) => m.body === 'look' && (m.attachments?.length ?? 0) === 1);
    const pointer = received.attachments![0]!;
    expect(pointer).toMatchObject({ fileName: 'cat.png', contentType: 'image/png' });
    // The object store only ever holds ciphertext.
    const stored = server.objects.get(pointer.attachmentId)!;
    expect(stored).toBeDefined();
    expect(Buffer.from(stored).includes(Buffer.from(PNG))).toBe(false);
    expect(await bytesOf(await bob.client.downloadAttachment(pointer))).toEqual(PNG);
  });

  it('several files go out as one message', async () => {
    await ana.client.sendAttachments(bobId, [new File([PNG], 'a.png', { type: 'image/png' }), new File([new TextEncoder().encode('notes')], 'b.txt', { type: 'text/plain' })], '');
    const received = await see(bob, anaId, (m) => (m.attachments?.length ?? 0) === 2);
    expect(received.attachments!.map((a) => a.fileName)).toEqual(['a.png', 'b.txt']);
  });

  it('a tampered blob is refused', async () => {
    await ana.client.sendAttachments(bobId, [new File([PNG], 'evil.png', { type: 'image/png' })], 'tamper');
    const received = await see(bob, anaId, (m) => m.body === 'tamper');
    const pointer = received.attachments![0]!;
    server.objects.get(pointer.attachmentId)![20] ^= 0xff;
    await expect(bob.client.downloadAttachment(pointer)).rejects.toThrow();
  });

  it('view-once media opens once, then only shows as opened', async () => {
    await ana.client.sendAttachments(bobId, [new File([PNG], 'once.png', { type: 'image/png' })], '', undefined, { viewOnce: true });
    const received = await see(bob, anaId, (m) => !!(m as unknown as { viewOnce?: unknown }).viewOnce);
    expect(await bytesOf(await bob.client.openViewOnce(received))).toEqual(PNG);
    await bob.client.consumeViewOnce(received);
    const after = (await bob.client.message(anaId, anaId, received.id))!;
    await expect(bob.client.openViewOnce(after)).rejects.toThrow();
  });

  it('a voice note arrives as a playable voice message', async () => {
    await ana.client.sendVoiceNote(bobId, new File([new Uint8Array(200).fill(3)], 'voice.webm', { type: 'audio/webm' }), 4_200);
    const received = await see(bob, anaId, (m) => !!m.attachments?.[0]?.voiceNote);
    expect(received.attachments![0]!.durationMs).toBe(4_200);
  });
});

describe('attachment IDs from the server', () => {
  it('a malformed ID is refused instead of sending a message nobody can read', async () => {
    server.handle('attachmentUploadForm', () => ({ attachmentId: '../not-a-uuid', uploadUrl: 'https://objects.test/x', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    await expect(ana.client.sendAttachments(bobId, [new File([PNG], 'x.png', { type: 'image/png' })], 'bad id')).rejects.toThrow('invalid attachment ID');
    await new Promise((r) => setTimeout(r, 300));
    expect((await bob.client.messages(anaId)).some((m) => m.body === 'bad id' || m.undecryptable)).toBe(false);
  });
});

describe('custom stickers', () => {
  it('can be created, favourited, sent, saved by the recipient and removed', async () => {
    const id = await ana.client.addCustomSticker(PNG, 'image/png');
    expect((await ana.client.stickerCollection()).custom.map((c) => c.id)).toContain(id);
    await ana.client.toggleFavoriteSticker({ pack: 'custom', id });
    expect((await ana.client.stickerCollection()).favorites).toContainEqual(expect.objectContaining({ id }));
    await ana.client.toggleFavoriteSticker({ pack: 'custom', id });
    expect((await ana.client.stickerCollection()).favorites).toEqual([]);

    await ana.client.sendSticker(bobId, 'custom', id);
    const received = await see(bob, anaId, (m) => (m as unknown as { sticker?: { id: string } }).sticker?.id === id);
    const sticker = (received as unknown as { sticker: { id: string; attachment?: never } }).sticker;
    expect(await bob.client.customStickerBytes(sticker)).toEqual(PNG);
    const saved = await bob.client.saveSticker(received);
    expect((await bob.client.stickerCollection()).custom.map((c) => c.id)).toContain(saved);

    await ana.client.removeCustomSticker(id);
    expect((await ana.client.stickerCollection()).custom.map((c) => c.id)).not.toContain(id);
  });
});

describe('abuse reports', () => {
  it('only the chosen messages reach the security contact, encrypted', async () => {
    const security = await server.enroll('security-desk', 'Security Desk');
    await security.client.start(); await until(() => security.connection === 'online');
    expect((await bob.client.reportRecipients()).map((r) => r.displayName)).toEqual(['Security Desk']);
    await ana.client.sendText(bobId, 'buy crypto now');
    const spam = await see(bob, anaId, (m) => m.body === 'buy crypto now');
    await bob.client.sendReport(security.account.accountId, { reportId: 'r'.repeat(32), reason: 'spam', conversationId: anaId, messages: [spam], reportedAccountId: anaId });
    const report = await see(security, bobId, (m) => !!(m as unknown as { report?: unknown }).report);
    const body = (report as unknown as { report: { items: { text?: string }[]; reason: string; reported?: { accountId: string } } }).report;
    expect(body.reason).toBe('spam');
    expect(body.items.map((m) => m.text)).toEqual(['buy crypto now']);
    expect(body.reported?.accountId).toBe(anaId);
    // The server relayed only ciphertext.
    expect(JSON.stringify(server.mailbox(security.account))).not.toContain('crypto now');
    security.client.stop();
  });
});

describe('acknowledgement requests', () => {
  it('are refused outside community announcement channels', async () => {
    const group = await ana.client.createGroup('Safety', [dto(bob)], true);
    await until(() => !!bob.client.conversations().find((c) => c.id === group.id));
    await expect(ana.client.sendText(group.id, 'New fire drill rules', undefined, undefined, { due: Date.now() + 86_400_000 }))
      .rejects.toThrow('acknowledgements are for community announcements');
    // In a 1:1 chat the request is dropped: the message goes out as a plain message.
    await ana.client.sendText(bobId, 'ack please?', undefined, undefined, true);
    expect((await see(bob, anaId, (m) => m.body === 'ack please?')).ackRequest).toBeUndefined();
  });
});

describe('member policy', () => {
  it('slow mode spaces member posts and restricted members cannot post', async () => {
    const group = await ana.client.createGroup('Busy', [dto(bob)]);
    await until(() => !!bob.client.conversations().find((c) => c.id === group.id));
    await ana.client.setMemberPolicy(group.id, { slowModeSeconds: 60 });
    await until(() => bob.client.conversations().find((c) => c.id === group.id)?.memberPolicy?.slowModeSeconds === 60);
    await bob.client.sendText(group.id, 'first');
    await see(ana, group.id, (m) => m.body === 'first');
    expect(await bob.client.nextPostAt(group.id)).toBeGreaterThan(Date.now());
    await expect(bob.client.sendText(group.id, 'second')).rejects.toThrow(/slow/);

    await ana.client.setMemberPolicy(group.id, { slowModeSeconds: 0, restricted: [bobId] });
    await until(() => (bob.client.conversations().find((c) => c.id === group.id)?.memberPolicy?.restricted ?? []).includes(bobId));
    await expect(bob.client.sendText(group.id, 'can I?')).rejects.toThrow();
  });
});

describe('server directives', () => {
  it('KEYS_LOW makes the device upload a fresh prekey batch', async () => {
    const device = server.accounts.get(bobId)!.devices.get(1)!;
    device.preKeys.length = 0;
    server.directive(bob.account, 1, 'KEYS_LOW');
    await until(() => device.preKeys.length >= 100);
  });

  it('REVOKED wipes the device and tells the UI', async () => {
    let revoked = false;
    bob.client.on('revoked', () => { revoked = true; });
    server.directive(bob.account, 1, 'REVOKED');
    await until(() => revoked);
  });
});

describe('retrying', () => {
  it('a message that failed can be sent again', async () => {
    const realDeliver = server.deliver.bind(server);
    let fail = true;
    // A permanent refusal fails the message (RATE_LIMITED would only pause it until the next flush).
    server.deliver = (sender, request) => (fail ? { ok: false, errorCode: 'FORBIDDEN' } : realDeliver(sender, request));
    await ana.client.sendText(bobId, 'try again').catch(() => undefined);
    await until(async () => (await ana.client.messages(bobId)).some((m) => m.body === 'try again' && m.status === 'failed'));
    fail = false;
    const failed = (await ana.client.messages(bobId)).find((m) => m.body === 'try again')!;
    await ana.client.retry(failed);
    await see(bob, anaId, (m) => m.body === 'try again');
  });
});
