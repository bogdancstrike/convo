import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send, startChat } from './support';

async function enableReadReceipts(page: Page) {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-card-privacy').click();
  await page.getByTestId('toggle-read-receipts').click();
  await expect(page.getByTestId('toggle-read-receipts')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('nav-chats').click();
}

/** FEAT-02 message requests: first contact sends no read receipts until accepted. */
test('a first message is a request; read receipts start only after accepting', async ({ browser, request }) => {
  const aliceU = await createUser(request, 'newcontact');
  const bobU = await createUser(request, 'requested');
  const alice = await newPage(browser);
  const bob = await newPage(browser);
  try {
    await enroll(alice, aliceU);
    await enroll(bob, bobU);
    await enableReadReceipts(alice);
    await enableReadReceipts(bob);
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'hi, we have not talked before');

    const row = bob.locator('.chat-row').filter({ hasText: aliceU.name });
    await expect(row.getByTestId('request-tag')).toBeVisible({ timeout: 20_000 });
    await openChat(bob, aliceU.name);
    await expect(bob.getByTestId('request-banner')).toBeVisible();
    await expect(message(alice, 'hi, we have not talked before').getByTestId('message-status')).toHaveText('Received');
    await bob.waitForTimeout(2500);
    await expect(message(alice, 'hi, we have not talked before').getByTestId('message-status')).toHaveText('Received');

    await bob.getByTestId('request-accept').click();
    await expect(bob.getByTestId('request-banner')).toHaveCount(0);
    await send(alice, 'thanks for accepting');
    await expect(message(alice, 'thanks for accepting').getByTestId('message-status')).toHaveText('Seen', { timeout: 20_000 });
  } finally { await closeAll(alice, bob); }
});
