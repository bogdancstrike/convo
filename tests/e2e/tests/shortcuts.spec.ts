import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, send, startChat } from './support';

/** Specs §30.8 fast accessible actions: keyboard shortcuts on a focused message (web). */
test('keyboard shortcuts act on the focused message only', async ({ browser, request }) => {
  const [aliceU, bobU] = await Promise.all(['kbalice', 'kbbob'].map((p) => createUser(request, p)));
  const [alice, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(alice, aliceU); await enroll(bob, bobU);
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'first line');
    await send(alice, 'second line');
    const second = message(alice, 'second line').locator('.bubble');
    const first = message(alice, 'first line').locator('.bubble');

    // Typing in the composer never triggers shortcuts.
    await alice.getByTestId('composer').fill('rse');
    await expect(alice.locator('.composer-context')).toHaveCount(0);
    await alice.getByTestId('composer').fill('');

    await second.focus();
    await alice.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();
    await alice.keyboard.press('s');
    await expect(message(alice, 'first line').getByTestId('starred')).toBeVisible();
    await alice.keyboard.press('ArrowDown');
    await expect(second).toBeFocused();
    await alice.keyboard.press('r');
    await expect(alice.locator('.composer-context')).toContainText('second line');
    await alice.locator('.composer-context').getByRole('button').click(); // cancel the reply
    await second.focus();
    await alice.keyboard.press('e');
    await expect(alice.getByTestId('composer')).toHaveValue('second line');
    await alice.locator('.composer-context').getByRole('button').click(); // cancel editing

    // Delete asks first; Escape cancels and returns focus to the message.
    await second.focus();
    await alice.keyboard.press('Delete');
    await expect(alice.getByTestId('delete-me')).toBeVisible();
    await alice.keyboard.press('Escape');
    await expect(alice.getByTestId('delete-me')).toHaveCount(0);
    await expect(message(alice, 'second line')).toBeVisible();

    // The shortcuts are documented in Settings.
    await alice.getByTestId('nav-settings').click();
    await alice.getByTestId('settings-card-chats').click();
    await expect(alice.getByTestId('shortcut-list')).toContainText('Reply');
  } finally { await closeAll(alice, bob); }
});
