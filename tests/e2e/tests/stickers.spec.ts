import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send, startChat } from './support';

/** AC-MED-04: bundled stickers send as pack/sticker IDs, render after integrity checks, altered files are refused. */
test('send a bundled sticker; recipients render it and refuse an altered file', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [amyU, bobU] = await Promise.all(['stickamy', 'stickbob'].map((p) => createUser(request, p)));
  const [amy, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(amy, amyU); await enroll(bob, bobU);
    // Bob's copy of the heart sticker is tampered with (e.g. a modified static host).
    await bob.route('**/stickers/basics/heart.webp', async (route) => {
      const real = await (await route.fetch()).body(); real[200] ^= 0xff;
      await route.fulfill({ status: 200, contentType: 'image/webp', body: real });
    });
    await startChat(amy, bobU);
    await send(amy, 'stickers incoming');
    await amy.getByTestId('emoji-button').click();
    await amy.getByTestId('picker-stickers').click();
    await amy.getByTestId('sticker-thumbs-up').click();
    await expect(amy.getByTestId('emoji-picker')).toHaveCount(0);
    await expect(amy.getByTestId('message').getByTestId('sticker-image')).toHaveCount(1);

    await amy.getByTestId('emoji-button').click(); await amy.getByTestId('picker-stickers').click();
    await amy.getByTestId('sticker-heart').click();

    await bob.getByTestId('nav-chats').click();
    await expect(bob.locator('.chat-row').filter({ hasText: 'Sticker' })).toBeVisible({ timeout: 20_000 }); // list preview
    await bob.locator('.chat-row > button.row').filter({ hasText: 'Sticker' }).click();
    await expect(bob.getByTestId('message').getByTestId('sticker-image')).toHaveCount(1, { timeout: 20_000 }); // thumbs up verified
    await expect(bob.getByTestId('message').getByTestId('sticker-placeholder')).toHaveCount(1); // altered heart refused
  } finally { await closeAll(amy, bob); }
});
