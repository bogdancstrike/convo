import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, send, startChat } from './support';

/** Records notifications instead of showing them (permission granted). */
async function fakeNotifications(page: Page) {
  await page.addInitScript(() => {
    const notes: { title: string; body?: string }[] = [];
    (window as unknown as { __notes: typeof notes }).__notes = notes;
    class FakeNotification { static permission = 'granted'; static async requestPermission() { return 'granted'; }
      onclick: (() => void) | null = null; constructor(title: string, options?: { body?: string }) { notes.push({ title, body: options?.body }); } close() {} }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
  });
}
const notes = (page: Page) => page.evaluate(() => (window as unknown as { __notes: { title: string; body?: string }[] }).__notes);

test('opt-in notifications are generic by default, can show text, and respect mute', async ({ browser, request }) => {
  const aliceU = await createUser(request, 'notifier');
  const bobU = await createUser(request, 'notified');
  const alice = await newPage(browser);
  const bob = await newPage(browser);
  try {
    await fakeNotifications(bob);
    await enroll(alice, aliceU);
    await enroll(bob, bobU);
    await bob.getByTestId('nav-settings').click();
    await bob.getByTestId('settings-card-notifications').click();
    await bob.getByTestId('toggle-notifications').click();
    await expect(bob.getByTestId('toggle-notifications')).toHaveAttribute('aria-checked', 'true');

    await startChat(alice, bobU, bobU.name);
    await send(alice, 'private plans');
    await expect.poll(() => notes(bob)).toEqual([{ title: 'Convo', body: 'New message' }]);

    await bob.getByTestId('notification-preview').getByRole('radio', { name: 'Sender and text' }).click();
    await send(alice, 'second note');
    await expect.poll(async () => (await notes(bob)).at(-1)).toEqual({ title: aliceU.name, body: 'second note' });

    // The chat on screen does not alert; a muted chat never alerts.
    await openChat(bob, aliceU.name);
    await send(alice, 'while reading');
    await bob.waitForTimeout(2500);
    expect(await notes(bob)).toHaveLength(2);
    await bob.getByTestId('thread-menu').click();
    await bob.getByTestId('menu-mute').click();
    await bob.getByTestId('menu-mute-always').click();
    await bob.getByTestId('nav-chats').click();
    await bob.getByTestId('thread-menu').click(); await bob.getByRole('menuitem', { name: 'Close chat' }).click();
    await send(alice, 'muted now');
    await bob.waitForTimeout(3000);
    expect(await notes(bob)).toHaveLength(2);
  } finally { await closeAll(alice, bob); }
});
