import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send, startChat } from './support';

async function fakeNotifications(page: Page) {
  await page.addInitScript(() => {
    const notes: { title: string }[] = [];
    (window as unknown as { __notes: typeof notes }).__notes = notes;
    class FakeNotification { static permission = 'granted'; static async requestPermission() { return 'granted'; }
      onclick: (() => void) | null = null; constructor(title: string) { notes.push({ title }); } close() {} }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
  });
}
const count = (page: Page) => page.evaluate(() => (window as unknown as { __notes: unknown[] }).__notes.length);

/** Specs §30.8 timed snoozing: exact time shown first, alerts paused, messages still arrive, End snooze. */
test('snoozing pauses alerts until ended, without hiding messages', async ({ browser, request }) => {
  const [aliceU, bobU] = await Promise.all(['snalice', 'snbob'].map((p) => createUser(request, p)));
  const [alice, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await fakeNotifications(bob);
    await enroll(alice, aliceU); await enroll(bob, bobU);
    await bob.getByTestId('nav-settings').click();
    await bob.getByTestId('settings-card-notifications').click();
    await bob.getByTestId('toggle-notifications').click();
    await bob.getByTestId('nav-chats').click();
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'before snooze');
    await expect.poll(() => count(bob)).toBe(1);

    // Snooze from the chat list menu; the dialog shows the exact time and zone before confirming.
    const row = bob.locator('.chat-row').filter({ hasText: aliceU.name });
    await row.hover();
    await row.locator('.chat-row-menu').click();
    await bob.getByTestId('menu-snooze').click();
    await bob.getByTestId('snooze-4h').check();
    await expect(bob.getByTestId('snooze-summary')).toContainText('Snoozed until');
    await expect(bob.getByTestId('snooze-summary')).toContainText('(');
    await bob.getByTestId('snooze-confirm').click();
    await expect(row.getByTestId('snoozed')).toBeVisible();

    await send(alice, 'during snooze');
    await expect(row).toContainText('during snooze', { timeout: 20_000 }); // still arrives
    await bob.waitForTimeout(2500);
    expect(await count(bob)).toBe(1);

    // End snooze now: alerts resume (no backlog flood of what arrived meanwhile).
    await row.hover(); await row.locator('.chat-row-menu').click();
    await bob.getByTestId('menu-snooze-end').click();
    await expect(row.getByTestId('snoozed')).toHaveCount(0);
    await send(alice, 'after snooze');
    await expect.poll(() => count(bob)).toBe(2);
    // A time in the past cannot be confirmed.
    await row.hover(); await row.locator('.chat-row-menu').click();
    await bob.getByTestId('menu-snooze').click();
    await bob.getByTestId('snooze-custom').check();
    await bob.getByTestId('snooze-custom-at').fill('2020-01-01T10:00');
    await expect(bob.getByTestId('snooze-confirm')).toBeDisabled();
  } finally { await closeAll(alice, bob); }
});
