import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, messageMenu, newPage, openChat, send, startChat } from './support';

/**
 * Edit policy (specs §25.1): own text is editable for the deployment window (15 minutes by
 * default), edits update every recipient without a new notification, and the window closes.
 */
test('edits reach the recipient silently and the Edit action closes after the window', async ({ browser, request }) => {
  const info = await (await request.get('/v1/deployment-info')).json();
  expect(info.limits).toMatchObject({ editWindowMs: 15 * 60_000, channelEditWindowMs: 30 * 24 * 3600_000 });
  const aliceUser = await createUser(request, 'editor');
  const bobUser = await createUser(request, 'reader');
  const alice = await newPage(browser);
  const bob = await newPage(browser);
  try {
    // Controls Date.now only; timers keep running in real time.
    await alice.clock.install();
    await enroll(alice, aliceUser);
    await enroll(bob, bobUser);
    await startChat(alice, bobUser, bobUser.name);
    await send(alice, 'Meeting at 10');
    await openChat(bob, aliceUser.name);
    await expect(message(bob, 'Meeting at 10')).toBeVisible();
    await bob.getByTestId('nav-chats').click();

    await (await messageMenu(alice, 'Meeting at 10')).getByTestId('action-edit').click();
    await alice.getByTestId('composer').fill('Meeting at 11');
    await alice.getByTestId('send').click();
    // The recipient acknowledges the new revision; the edit adds no unread badge.
    await expect(message(alice, 'Meeting at 11').getByTestId('message-status')).toHaveText('Received');
    const row = bob.locator('.chat-row').filter({ hasText: aliceUser.name });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Meeting at 11');
    await expect(row.locator('.badge')).toHaveCount(0);
    await openChat(bob, aliceUser.name);
    await expect(message(bob, 'Meeting at 11')).toContainText('edited');
    await expect(message(bob, 'Meeting at 10')).toHaveCount(0);

    await alice.clock.setSystemTime(Date.now() + 16 * 60_000);
    const menu = await messageMenu(alice, 'Meeting at 11');
    await expect(menu.getByTestId('action-reply')).toBeVisible();
    await expect(menu.getByTestId('action-edit')).toHaveCount(0);
  } finally { await closeAll(alice, bob); }
});
