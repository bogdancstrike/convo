import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send, startChat } from './support';

/** First-unread navigation (FEAT-03): divider, starting position, jump-to-latest with new count. */
test('opening a chat starts at the first unread message and can jump to the latest', async ({ browser, request }) => {
  const aliceU = await createUser(request, 'chatty');
  const bobU = await createUser(request, 'reader');
  const alice = await newPage(browser);
  const bob = await newPage(browser);
  try {
    await enroll(alice, aliceU);
    await enroll(bob, bobU);
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'read before');
    await openChat(bob, aliceU.name);
    await expect(message(bob, 'read before')).toBeVisible();
    await bob.getByTestId('nav-chats').click();
    await bob.getByTestId('thread-menu').click(); await bob.getByRole('menuitem', { name: 'Close chat' }).click();

    for (let i = 1; i <= 30; i++) await send(alice, `update ${i}`);
    await expect(message(alice, 'update 30')).toBeVisible();
    const row = bob.locator('.chat-row').filter({ hasText: aliceU.name });
    await expect(row.locator('.badge')).toHaveText('30', { timeout: 30_000 });

    await openChat(bob, aliceU.name);
    const divider = bob.getByTestId('unread-divider');
    await expect(divider).toHaveText('30 unread messages');
    await expect(divider).toBeInViewport();
    await expect(message(bob, 'update 1')).toBeInViewport();
    await expect(message(bob, 'update 30')).not.toBeInViewport();

    await send(alice, 'one more');
    await expect(bob.getByTestId('jump-latest-count')).toHaveText('1', { timeout: 20_000 });
    await bob.getByTestId('jump-latest').click();
    await expect(message(bob, 'one more')).toBeInViewport();
    await expect(bob.getByTestId('jump-latest')).toHaveCount(0);
  } finally { await closeAll(alice, bob); }
});
