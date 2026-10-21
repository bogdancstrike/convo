import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send, startChat } from './support';

/** First message whose row is visible at the top of the message list. */
async function topMessage(page: Page): Promise<string> {
  return page.getByTestId('message-list').evaluate((list) => {
    const top = list.getBoundingClientRect().top;
    for (const row of list.querySelectorAll<HTMLElement>('[data-testid="message"]')) {
      if (row.getBoundingClientRect().bottom > top + 4) return row.querySelector('[data-testid="message-body"]')?.textContent ?? '';
    }
    return '';
  });
}

/** Specs §30.8 unread catch-up: device-local reading position, restored on return and reload. */
test('the reading position is kept per chat and "back to where you were" returns there', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const [aliceU, bobU] = await Promise.all(['rpalice', 'rpbob'].map((p) => createUser(request, p)));
  const [alice, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(alice, aliceU); await enroll(bob, bobU);
    await startChat(alice, bobU, bobU.name);
    for (let i = 1; i <= 40; i++) await send(alice, `line ${String(i).padStart(2, '0')}`);
    await openChat(bob, aliceU.name);
    await expect(message(bob, 'line 40')).toBeVisible({ timeout: 30_000 });

    // Scroll up to line 12 and leave the chat.
    await message(bob, 'line 12').scrollIntoViewIfNeeded();
    await bob.getByTestId('message-list').evaluate((list) => {
      const row = [...list.querySelectorAll<HTMLElement>('[data-testid="message"]')].find((r) => r.textContent?.includes('line 12'))!;
      list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    });
    await expect.poll(() => topMessage(bob)).toBe('line 12');
    await bob.waitForTimeout(800); // debounced save
    await bob.getByTestId('nav-chats').click();
    await bob.getByTestId('thread-menu').click().catch(() => undefined);
    await bob.keyboard.press('Escape');
    await bob.getByTestId('thread-menu').click(); await bob.getByRole('menuitem', { name: 'Close chat' }).click();

    await openChat(bob, aliceU.name);
    await expect.poll(() => topMessage(bob)).toBe('line 12');
    await bob.reload({ waitUntil: 'domcontentloaded' });
    await expect(bob.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => topMessage(bob), { timeout: 20_000 }).toBe('line 12');

    // Jump to the latest message, then come back.
    await bob.getByTestId('jump-latest').click();
    await expect(message(bob, 'line 40')).toBeInViewport();
    await bob.getByTestId('return-position').click();
    await expect.poll(() => topMessage(bob)).toBe('line 12');
  } finally { await closeAll(alice, bob); }
});
