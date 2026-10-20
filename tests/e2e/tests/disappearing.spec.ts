import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send, startChat } from './support';

/** Disappearing messages (specs §17): authenticated timer change, badges, expiry on schedule. */
test('a chat timer reaches both sides and expired messages disappear', async ({ browser, request }) => {
  const aliceU = await createUser(request, 'timer');
  const bobU = await createUser(request, 'timerpeer');
  const alice = await newPage(browser);
  const bob = await newPage(browser);
  try {
    await alice.clock.install(); // lets the test jump past the 24-hour deadline
    await enroll(alice, aliceU);
    await enroll(bob, bobU);
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'before the timer');
    await openChat(bob, aliceU.name);
    await expect(message(bob, 'before the timer')).toBeVisible();

    await alice.getByTestId('thread-info').click();
    const timer = alice.getByTestId('disappearing-timer');
    await timer.getByRole('radio', { name: '24 hours' }).click();
    await expect(timer.getByRole('radio', { name: '24 hours' })).toBeChecked();
    await expect(alice.getByTestId('timer-notice')).toHaveText('You set disappearing messages to 24 hours');
    await expect(bob.getByTestId('timer-notice')).toHaveText(`${aliceU.name} set disappearing messages to 24 hours`, { timeout: 20_000 });
    await bob.getByTestId('thread-info').click();
    await expect(bob.getByTestId('disappearing-timer').getByRole('radio', { name: '24 hours' })).toBeChecked();

    await send(alice, 'self-destructing note');
    await expect(message(bob, 'self-destructing note').getByTestId('message-timer')).toBeVisible();
    await expect(message(alice, 'self-destructing note').getByTestId('message-timer')).toBeVisible();
    await expect(message(alice, 'before the timer').getByTestId('message-timer')).toHaveCount(0);

    // Sent messages expire 24 h after sending; older messages without a timer stay.
    await alice.clock.fastForward('24:01:00');
    await expect(message(alice, 'self-destructing note')).toHaveCount(0, { timeout: 20_000 });
    await expect(message(alice, 'before the timer')).toBeVisible();
  } finally { await closeAll(alice, bob); }
});
