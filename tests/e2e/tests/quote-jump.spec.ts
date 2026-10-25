import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, messageMenu, newPage, send, startChat } from './support';

/** WhatsApp: tapping a quoted reply scrolls to the original and flashes it; the arrow goes back down. */
test('tapping a quote jumps to the original message and the arrow returns to the latest', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [aliceUser, bobUser] = await Promise.all([createUser(request, 'quoter'), createUser(request, 'quoted')]);
  const [alice, bob] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    await Promise.all([enroll(alice, aliceUser), enroll(bob, bobUser)]);
    await startChat(alice, bobUser, bobUser.name);
    await send(alice, 'The original question');
    for (let i = 1; i <= 25; i++) await send(alice, `filler ${i}`);
    await (await messageMenu(alice, 'The original question')).getByTestId('action-reply').click();
    await alice.getByTestId('composer').fill('The answer');
    await alice.getByTestId('send').click();
    const original = message(alice, 'The original question');
    await expect(original).not.toBeInViewport();

    await message(alice, 'The answer').getByTestId('quote').click();
    await expect(original).toBeInViewport();
    await expect(original).toHaveClass(/flashed/);
    await alice.getByTestId('jump-latest').click();
    await expect(message(alice, 'The answer')).toBeInViewport();
  } finally { await closeAll(alice, bob); }
});
