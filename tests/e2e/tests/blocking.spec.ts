import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send, startChat } from './support';

/** Blocking (FEAT-02): blocked contacts' direct messages are dropped; unblocking restores delivery. */
test('a blocked contact cannot reach you until you unblock them', async ({ browser, request }) => {
  const aliceU = await createUser(request, 'blocked');
  const bobU = await createUser(request, 'blocker');
  const alice = await newPage(browser);
  const bob = await newPage(browser);
  try {
    await enroll(alice, aliceU);
    await enroll(bob, bobU);
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'hello before');
    await openChat(bob, aliceU.name);
    await expect(message(bob, 'hello before')).toBeVisible();

    bob.once('dialog', (d) => void d.accept());
    await bob.getByTestId('thread-menu').click();
    await bob.getByTestId('menu-block').click();
    await expect(bob.getByTestId('blocked-banner')).toContainText(`You blocked ${aliceU.name}`);
    await expect(bob.getByTestId('composer')).toHaveCount(0);
    await expect(bob.getByTestId('start-voice-call')).toHaveCount(0);

    await send(alice, 'while blocked');
    await expect(message(alice, 'while blocked').getByTestId('message-status')).toHaveText('Sent');
    await bob.waitForTimeout(4000);
    await expect(message(bob, 'while blocked')).toHaveCount(0);
    // No delivery receipt goes back to a blocked sender.
    await expect(message(alice, 'while blocked').getByTestId('message-status')).toHaveText('Sent');

    await bob.getByTestId('unblock').click();
    await expect(bob.getByTestId('composer')).toBeVisible();
    await send(alice, 'after unblock');
    await expect(message(bob, 'after unblock')).toBeVisible();
    await expect(message(bob, 'while blocked')).toHaveCount(0);
  } finally { await closeAll(alice, bob); }
});
