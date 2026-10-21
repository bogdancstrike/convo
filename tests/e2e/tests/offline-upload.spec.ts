import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { closeAll, createUser, enroll, message, newPage, openChat, send, startChat } from './support';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');

/** FEAT-01: a photo sent while offline waits locally and is uploaded and delivered once online. */
test('a photo sent offline is queued and delivered when the connection returns', async ({ browser, request }) => {
  const senderU = await createUser(request, 'offsender');
  const recipientU = await createUser(request, 'offrecipient');
  const sender = await newPage(browser);
  const recipient = await newPage(browser);
  try {
    await enroll(sender, senderU);
    await enroll(recipient, recipientU);
    await startChat(sender, recipientU, recipientU.name);
    await send(sender, 'before going offline');
    await openChat(recipient, senderU.name);
    await expect(message(recipient, 'before going offline')).toBeVisible();

    await sender.context().setOffline(true);
    await sender.getByTestId('file-input').setInputFiles({ name: 'offline.png', mimeType: 'image/png', buffer: PNG });
    await sender.getByTestId('preview-caption').fill('sent while offline');
    await sender.getByTestId('preview-send').click();
    await expect(sender.getByTestId('pending-upload')).toContainText('offline');
    await expect(sender.getByTestId('pending-upload')).toContainText('waiting for connection');

    await sender.context().setOffline(false);
    await expect(sender.getByTestId('pending-upload')).toHaveCount(0, { timeout: 45_000 });
    const delivered = message(recipient, 'sent while offline');
    await expect(delivered).toBeVisible({ timeout: 30_000 });
    await expect(delivered.getByTestId('attachment-image').locator('img')).toBeVisible({ timeout: 20_000 });
    await expect(recipient.getByTestId('message-body').getByText('sent while offline')).toHaveCount(1);
  } finally { await closeAll(sender, recipient); }
});

/**
 * FEAT-01 resumable uploads: a large file goes up in parts; when the connection drops mid-way the
 * upload is queued, and on resume only the missing parts are sent. The recipient gets the exact file.
 */
test('a large upload interrupted mid-way resumes without re-sending finished parts', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const senderU = await createUser(request, 'resender');
  const recipientU = await createUser(request, 'rerecipient');
  const sender = await newPage(browser);
  const recipient = await newPage(browser);
  try {
    await enroll(sender, senderU);
    await enroll(recipient, recipientU);
    await startChat(sender, recipientU, recipientU.name);
    await send(sender, 'big file coming');
    await openChat(recipient, senderU.name);
    await expect(message(recipient, 'big file coming')).toBeVisible();

    const content = Buffer.alloc(20 * 1024 * 1024);
    for (let i = 0; i < content.length; i += 4) content.writeUInt32LE((i * 2654435761) >>> 0, i);
    const parts: number[] = [];
    let outage = true;
    await sender.route('**/enclave-attachments/**', async (route) => {
      const part = Number(new URL(route.request().url()).searchParams.get('partNumber') ?? 0);
      if (route.request().method() === 'PUT' && part) {
        if (outage && part === 3) return route.abort('internetdisconnected');
        parts.push(part);
      }
      return route.continue();
    });
    await sender.getByTestId('file-input').setInputFiles({ name: 'large.bin', mimeType: 'application/octet-stream', buffer: content });
    await sender.getByTestId('preview-caption').fill('resumed upload');
    await sender.getByTestId('preview-send').click();
    await expect(sender.getByTestId('pending-upload')).toContainText('waiting for connection', { timeout: 90_000 });
    expect(parts).toEqual(expect.arrayContaining([1, 2]));
    expect(parts).not.toContain(3);

    outage = false;
    parts.length = 0;
    await sender.context().setOffline(true);
    await sender.context().setOffline(false);
    await expect(sender.getByTestId('pending-upload')).toHaveCount(0, { timeout: 90_000 });
    expect(parts).not.toContain(1);
    expect(parts).not.toContain(2);
    expect(parts).toContain(3);

    const delivered = message(recipient, 'resumed upload');
    await expect(delivered).toBeVisible({ timeout: 30_000 });
    const file = delivered.getByTestId('attachment-file');
    const [download] = await Promise.all([recipient.waitForEvent('download', { timeout: 90_000 }), file.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('large.bin');
    expect((await readFile((await download.path())!)).equals(content)).toBe(true);
  } finally { await closeAll(sender, recipient); }
});
