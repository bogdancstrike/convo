import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, send, startChat } from './support';

/** AC-SEC-09: only explicitly selected evidence reaches the chosen security contact, E2EE. */
test('abuse report: selected messages only, sent end-to-end encrypted to a security contact', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [officerU, bobU, aliceU] = await Promise.all([createUser(request, 'officer', { realmRoles: ['convo-security'] }), createUser(request, 'rbob'), createUser(request, 'ralice')]);
  const [officer, bob, alice] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    await Promise.all([enroll(officer, officerU), enroll(bob, bobU), enroll(alice, aliceU)]);
    await startChat(bob, aliceU, aliceU.name);
    await send(bob, 'You will regret this');
    await send(bob, 'Lunch tomorrow?');
    await openChat(alice, bobU.name);

    // The server caches the security-contact list for a minute: reopen until the new officer appears.
    const dialog = alice.getByTestId('report-dialog');
    await expect.poll(async () => {
      if (await dialog.count()) await alice.keyboard.press('Escape');
      await alice.getByTestId('thread-menu').click();
      await alice.getByTestId('menu-report').click();
      await alice.waitForTimeout(1000);
      return dialog.getByTestId('report-recipient').textContent();
    }, { timeout: 90_000, intervals: [5000] }).toContain(officerU.name);
    await dialog.getByTestId('report-recipient').selectOption({ label: officerU.name });
    // Nothing is pre-selected; the reporter chooses exactly what to share.
    await expect(dialog.getByTestId('report-send')).toBeDisabled();
    await dialog.locator('label.report-item', { hasText: 'You will regret this' }).getByTestId('report-message').check();
    await dialog.getByTestId('report-reason').fill('Threatening message');
    await expect(dialog.getByTestId('report-disclosure')).toContainText(`1 selected messages`);
    await expect(dialog.getByTestId('report-disclosure')).toContainText(officerU.name);
    await dialog.getByTestId('report-send').click();
    await expect(dialog.getByTestId('report-sent')).toBeVisible({ timeout: 20_000 });

    await openChat(officer, aliceU.name);
    const card = officer.getByTestId('report-card');
    await expect(card).toContainText('Threatening message', { timeout: 20_000 });
    await expect(card).toContainText('You will regret this');
    await expect(card).not.toContainText('Lunch tomorrow?');
    await expect(card).toContainText(bobU.name.split(' ')[0]!);
  } finally { await closeAll(officer, bob, alice); }
});
