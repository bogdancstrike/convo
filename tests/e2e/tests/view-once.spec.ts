import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, startChat, send } from './support';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');

/** Specs §30.4: view-once photo opens once, leaves no copy, cannot be forwarded. */
test('view-once photo: recipient opens it once, it is consumed everywhere; the sender keeps no copy', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [aliceU, bobU] = await Promise.all(['vonce', 'vbob'].map((p) => createUser(request, p)));
  const [alice, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(alice, aliceU); await enroll(bob, bobU);
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'something private coming');
    await openChat(bob, aliceU.name);

    await alice.getByTestId('file-input').setInputFiles([{ name: 'secret.png', mimeType: 'image/png', buffer: PNG }]);
    await alice.getByTestId('preview-view-once').click();
    await expect(alice.getByTestId('preview-view-once')).toHaveAttribute('aria-pressed', 'true');
    await alice.getByTestId('preview-send').click();
    // The sender keeps only the label, never the media.
    await expect(alice.getByTestId('view-once')).toHaveAttribute('data-state', 'sent', { timeout: 20_000 });
    await expect(alice.getByTestId('view-once')).toBeDisabled();

    const tile = bob.getByTestId('view-once');
    await expect(tile).toHaveAttribute('data-state', 'unopened', { timeout: 20_000 });
    await tile.click();
    const viewer = bob.getByTestId('view-once-viewer');
    await expect(viewer.locator('img')).toBeVisible();
    expect(await viewer.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8);
    await bob.getByTestId('view-once-close').click();
    await expect(viewer).toHaveCount(0);
    await expect(tile).toHaveAttribute('data-state', 'opened');
    await expect(tile).toBeDisabled();
    // Consumed state persists (the pointer and key are gone), even after a reload.
    await bob.reload();
    await openChat(bob, aliceU.name);
    await expect(bob.getByTestId('view-once')).toHaveAttribute('data-state', 'opened', { timeout: 20_000 });
    await expect(bob.getByTestId('view-once')).toContainText('Opened');
  } finally { await closeAll(alice, bob); }
});
