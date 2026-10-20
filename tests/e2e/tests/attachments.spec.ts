import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { closeAll, createUser, enroll, newPage, startChat } from './support';

/** 8×8 red PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * FEAT-01: files and photos are encrypted in the sender's browser, uploaded as ciphertext through
 * presigned URLs, and decrypted + digest-verified by the recipient.
 */
test('send an encrypted photo and file; recipient views and downloads them', async ({ browser, request }) => {
  const senderUser = await createUser(request, 'photo');
  const recipientUser = await createUser(request, 'viewer');
  const sender = await newPage(browser);
  const recipient = await newPage(browser);
  await enroll(sender, senderUser);
  await enroll(recipient, recipientUser);
  await startChat(sender, recipientUser.username);

  const fileText = `confidential report ${Date.now()}\nline two — ăîșțâ\n`;
  await sender.getByTestId('file-input').setInputFiles([
    { name: 'red.png', mimeType: 'image/png', buffer: PNG },
    { name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from(fileText, 'utf8') },
  ]);
  await expect(sender.getByTestId('pending-file')).toHaveCount(2);
  await sender.getByTestId('composer').fill('quarterly files');
  await sender.getByTestId('send').click();
  await expect(sender.getByTestId('pending-file')).toHaveCount(0);

  await recipient.getByTestId(`conversation-${senderUser.username}`).click();
  const image = recipient.getByTestId('attachment-image').locator('img');
  await expect(image).toBeVisible();
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8);
  await expect(recipient.getByTestId('message-body').getByText('quarterly files')).toBeVisible();

  const file = recipient.getByTestId('attachment-file');
  await expect(file).toContainText('report.txt');
  const [download] = await Promise.all([recipient.waitForEvent('download'), file.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('report.txt');
  expect(await readFile((await download.path())!, 'utf8')).toBe(fileText);

  await closeAll(sender, recipient);
});

test('the object store only ever receives ciphertext', async ({ browser, request }) => {
  const user = await createUser(request, 'store');
  const page = await newPage(browser);
  await enroll(page, user);
  await page.getByRole('button', { name: 'Note to self' }).first().click();

  const marker = `PLAINTEXT-MARKER-${Date.now()}`;
  const uploads: Buffer[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/enclave-attachments/')) uploads.push(r.postDataBuffer() ?? Buffer.alloc(0));
  });
  await page.getByTestId('file-input').setInputFiles([{ name: 'secret.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) }]);
  await page.getByTestId('send').click();
  await expect(page.getByTestId('attachment-file')).toContainText('secret.txt');
  expect(uploads.length).toBe(1);
  expect(uploads[0]!.includes(Buffer.from(marker))).toBe(false);
  expect(uploads[0]!.length).toBeGreaterThanOrEqual(541); // padded bucket
  await closeAll(page);
});
