import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, startChat } from './support';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');

/** FEAT-01 albums: several photos in one message show as a grid with "+N", viewer pages through all. */
test('five photos arrive as an album and the viewer reaches every photo', async ({ browser, request }) => {
  const senderU = await createUser(request, 'album');
  const viewerU = await createUser(request, 'albumview');
  const sender = await newPage(browser);
  const viewer = await newPage(browser);
  try {
    await enroll(sender, senderU);
    await enroll(viewer, viewerU);
    await startChat(sender, viewerU, viewerU.name);
    await sender.getByTestId('file-input').setInputFiles([1, 2, 3, 4, 5].map((n) => ({ name: `p${n}.png`, mimeType: 'image/png', buffer: PNG })));
    await sender.getByTestId('preview-send').click();

    await openChat(viewer, senderU.name);
    const album = viewer.getByTestId('album');
    await expect(album).toBeVisible({ timeout: 30_000 });
    await expect(album.locator('.album-tile')).toHaveCount(4);
    await expect(album.getByTestId('album-more')).toHaveText('+1');
    await expect(album.locator('img')).toHaveCount(4, { timeout: 20_000 });

    await album.locator('.album-tile').nth(3).getByTestId('attachment-image').click();
    const media = viewer.getByTestId('media-viewer');
    await expect(media.locator('a[download]')).toHaveAttribute('download', 'p4.png');
    await expect(viewer.locator('.media-thumbnail')).toHaveCount(5); // the chat's media list has loaded
    await viewer.keyboard.press('ArrowRight');
    await expect(media.locator('a[download]')).toHaveAttribute('download', 'p5.png');
  } finally { await closeAll(sender, viewer); }
});
