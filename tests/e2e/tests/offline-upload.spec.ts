import { expect, test } from '@playwright/test';
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
