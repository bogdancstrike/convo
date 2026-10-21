import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { closeAll, createUser, enroll, newPage, openChat, startChat, send } from './support';

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
  await startChat(sender, recipientUser);

  const fileText = `confidential report ${Date.now()}\nline two — ăîșțâ\n`;
  await sender.getByTestId('file-input').setInputFiles([
    { name: 'red.png', mimeType: 'image/png', buffer: PNG },
    { name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from(fileText, 'utf8') },
  ]);
  // Pre-send preview: both files listed, caption, send.
  await expect(sender.getByTestId('media-preview')).toBeVisible();
  await sender.getByTestId('preview-caption').fill('quarterly files');
  await sender.getByTestId('preview-send').click();
  await expect(sender.getByTestId('media-preview')).toHaveCount(0);

  await openChat(recipient, senderUser.name);
  const image = recipient.getByTestId('attachment-image').locator('img');
  await expect(image).toBeVisible();
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8);
  await expect(recipient.getByTestId('message-body').getByText('quarterly files')).toBeVisible();
  const pagesBefore = recipient.context().pages().length; const routeBefore = recipient.url();
  await recipient.getByTestId('attachment-image').click();
  await expect(recipient.getByTestId('media-viewer')).toBeVisible();
  await expect(recipient.getByTestId('media-image')).toBeVisible();
  expect(await recipient.getByTestId('media-image').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8);
  expect(recipient.context().pages()).toHaveLength(pagesBefore);
  await recipient.keyboard.press('Escape');
  await expect(recipient.getByTestId('media-viewer')).toHaveCount(0); expect(recipient.url()).toBe(routeBefore);


  const file = recipient.getByTestId('attachment-file');
  await expect(file).toContainText('report.txt');
  const [download] = await Promise.all([recipient.waitForEvent('download'), file.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('report.txt');
  expect(await readFile((await download.path())!, 'utf8')).toBe(fileText);

  // Shared content works from the info drawer and survives refresh/deep links.
  await send(sender, 'Project https://example.test/report and javascript:alert(1)');
  await expect(recipient.getByTestId('message-body').getByText('Project https://example.test/report and javascript:alert(1)')).toBeVisible();
  await recipient.getByTestId('thread-info').click();
  await recipient.getByTestId('open-shared-content').click();
  const gallery = recipient.getByTestId('shared-content');
  await expect(gallery.getByTestId('attachment-image')).toBeVisible();
  await recipient.reload({ waitUntil: 'domcontentloaded' });
  await expect(recipient.getByTestId('shared-content')).toBeVisible();
  await recipient.getByTestId('shared-docs').click();
  const galleryFile = recipient.getByTestId('shared-content').getByTestId('attachment-file');
  const [galleryDownload] = await Promise.all([recipient.waitForEvent('download'), galleryFile.getByRole('button', { name: 'Download' }).click()]);
  expect(await readFile((await galleryDownload.path())!, 'utf8')).toBe(fileText);
  await recipient.getByTestId('shared-links').click();
  await expect(recipient.getByTestId('shared-content').getByRole('link')).toHaveAttribute('href', 'https://example.test/report');
  await recipient.getByTestId('shared-back').click();
  await expect(recipient.getByTestId('info-drawer')).toBeVisible();

  await closeAll(sender, recipient);
});

test('the object store only ever receives ciphertext', async ({ browser, request }) => {
  const user = await createUser(request, 'store');
  const page = await newPage(browser);
  await enroll(page, user);
  await page.getByTestId('new-chat').click();
  await page.getByTestId('note-to-self').click();

  const marker = `PLAINTEXT-MARKER-${Date.now()}`;
  const uploads: Buffer[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/enclave-attachments/')) uploads.push(r.postDataBuffer() ?? Buffer.alloc(0));
  });
  await page.getByTestId('file-input').setInputFiles([{ name: 'secret.txt', mimeType: 'text/plain', buffer: Buffer.from(marker) }]);
  await page.getByTestId('preview-send').click();
  await expect(page.getByTestId('attachment-file')).toContainText('secret.txt');
  expect(uploads.length).toBe(1);
  expect(uploads[0]!.includes(Buffer.from(marker))).toBe(false);
  expect(uploads[0]!.length).toBeGreaterThanOrEqual(541); // padded bucket
  await closeAll(page);
});

test('record and send an encrypted voice note', async ({ browser, request }) => {
  const senderUser = await createUser(request, 'voice');
  const recipientUser = await createUser(request, 'listener');
  const sender = await newPage(browser);
  const recipient = await newPage(browser);
  await enroll(sender, senderUser);
  await enroll(recipient, recipientUser);
  await startChat(sender, recipientUser);

  // Empty composer shows the microphone; typing turns it into Send.
  await expect(sender.getByTestId('record')).toBeVisible();
  await sender.getByTestId('composer').fill('x');
  await expect(sender.getByTestId('send')).toBeVisible();
  await sender.getByTestId('composer').fill('');

  await sender.getByTestId('record').click();
  await sender.waitForTimeout(1500);
  await sender.getByTestId('send-voice').click();
  await expect(sender.getByTestId('audio-player')).toBeVisible();

  await openChat(recipient, senderUser.name);
  await expect(recipient.getByTestId('audio-player')).toBeVisible();
  await closeAll(sender, recipient);
});

test('photos and videos open in one viewer with keyboard navigation and download', async ({ browser, request }) => {
  const user = await createUser(request, 'mediaview'); const page = await newPage(browser); await enroll(page, user);
  await page.getByTestId('new-chat').click(); await page.getByTestId('note-to-self').click();
  await page.getByTestId('file-input').setInputFiles([
    { name: 'red.png', mimeType: 'image/png', buffer: PNG },
    { name: 'preview.webm', mimeType: 'video/webm', buffer: await readFile('fixtures/preview.webm') },
  ]);
  await page.getByTestId('preview-send').click();
  await page.getByTestId('attachment-image').click();
  await expect(page.getByTestId('media-image')).toBeVisible();
  await expect(page.locator('.media-thumbnail')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('media-video')).toBeVisible();
  await expect.poll(() => page.getByTestId('media-video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('media-viewer').getByRole('link', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('preview.webm');
  expect(await readFile((await download.path())!)).toEqual(await readFile('fixtures/preview.webm'));
  await page.keyboard.press('Escape'); await expect(page.getByTestId('media-viewer')).toHaveCount(0);
  await page.getByTestId('video-poster').click(); await expect(page.getByTestId('media-video')).toBeVisible();
  await page.getByTestId('close-media').click(); await expect(page.getByTestId('media-viewer')).toHaveCount(0);
  await closeAll(page);
});
