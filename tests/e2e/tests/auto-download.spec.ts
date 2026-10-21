import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, startChat } from './support';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');

/**
 * Storage and data → Media auto-download: with photos off, a received photo is not fetched until
 * the recipient taps it; the sender always sees its own photo.
 */
test('photo auto-download can be turned off and the photo loads on tap', async ({ browser, request }) => {
  const senderUser = await createUser(request, 'autosend');
  const recipientUser = await createUser(request, 'autorecv');
  const sender = await newPage(browser);
  const recipient = await newPage(browser);
  try {
    await enroll(sender, senderUser);
    await enroll(recipient, recipientUser);
    await recipient.getByTestId('nav-settings').click();
    await recipient.getByTestId('settings-card-storage').click();
    const photos = recipient.getByTestId('auto-download-photos');
    await expect(photos).toHaveAttribute('aria-checked', 'true');
    await expect(recipient.getByTestId('auto-download-videos')).toHaveAttribute('aria-checked', 'false');
    await photos.click();
    await expect(photos).toHaveAttribute('aria-checked', 'false');

    await startChat(sender, recipientUser);
    await sender.getByTestId('file-input').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: PNG });
    await sender.getByTestId('preview-send').click();
    await expect(sender.getByTestId('attachment-image').locator('img')).toBeVisible();

    let downloads = 0;
    recipient.on('request', (r) => { if (r.method() === 'GET' && r.url().includes('/enclave-attachments/')) downloads++; });
    await openChat(recipient, senderUser.name);
    const manual = recipient.getByTestId('attachment-image-download');
    await expect(manual).toBeVisible();
    await expect(manual).toContainText('B');
    // The sender's encrypted tiny preview is shown (blurred) before the photo is downloaded.
    await expect(manual).toHaveClass(/has-preview/);
    expect(await manual.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('data:image/jpeg');
    await recipient.waitForTimeout(1000);
    expect(downloads).toBe(0);
    await manual.click();
    const image = recipient.getByTestId('attachment-image').locator('img');
    await expect(image).toBeVisible();
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8);
    expect(downloads).toBeGreaterThan(0);

    // The preference survives a reload (device-local encrypted settings).
    await recipient.reload({ waitUntil: 'domcontentloaded' });
    await expect(recipient.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
    await recipient.getByTestId('nav-settings').click();
    await recipient.getByTestId('settings-card-storage').click();
    await expect(recipient.getByTestId('auto-download-photos')).toHaveAttribute('aria-checked', 'false');
  } finally { await closeAll(sender, recipient); }
});
