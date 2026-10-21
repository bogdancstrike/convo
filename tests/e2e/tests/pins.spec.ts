import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, messageMenu, newPage, openChat, send, startChat } from './support';

/** Shared pins (FEAT-02): pin for everyone, banner on both sides, unpin from the banner. */
test('pinning a message shows it to both people until it is unpinned', async ({ browser, request }) => {
  const aliceU = await createUser(request, 'pinner');
  const bobU = await createUser(request, 'pinpeer');
  const alice = await newPage(browser);
  const bob = await newPage(browser);
  try {
    await enroll(alice, aliceU);
    await enroll(bob, bobU);
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'meeting room 4B');
    await send(alice, 'something else');
    await openChat(bob, aliceU.name);
    await expect(message(bob, 'meeting room 4B')).toBeVisible();

    await (await messageMenu(bob, 'meeting room 4B')).getByTestId('action-pin').click();
    await expect(bob.getByTestId('pinned-excerpt')).toHaveText('meeting room 4B');
    await expect(alice.getByTestId('pinned-excerpt')).toHaveText('meeting room 4B', { timeout: 20_000 });

    await alice.getByTestId('unpin-banner').click();
    await expect(alice.getByTestId('pinned-banner')).toHaveCount(0);
    await expect(bob.getByTestId('pinned-banner')).toHaveCount(0, { timeout: 20_000 });
  } finally { await closeAll(alice, bob); }
});
