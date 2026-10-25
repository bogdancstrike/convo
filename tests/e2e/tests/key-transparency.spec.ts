import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send, startChat } from './support';

/**
 * TRUST-01 / AC-SEC-07 (slice): every enrollment is logged; after exchanging messages, each side's
 * contact info shows the other's keys verified against a head co-signed by the Compose witness.
 */
test('contact keys are verified against the witnessed key-transparency log', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [aliceU, bobU] = await Promise.all([createUser(request, 'ktalice'), createUser(request, 'ktbob')]);
  const [alice, bob] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    await Promise.all([enroll(alice, aliceU), enroll(bob, bobU)]);
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'checking our keys');
    await openChat(bob, aliceU.name);
    await expect(message(bob, 'checking our keys')).toBeVisible({ timeout: 20_000 });
    await send(bob, 'keys look fine');

    // The witness re-checks within seconds in Compose; poll the drawer until a co-signed head covers both.
    for (const [page] of [[alice], [bob]] as const) {
      await expect(async () => {
        await page.getByTestId('thread-info').click();
        await expect(page.getByTestId('kt-status')).toHaveAttribute('data-status', 'verified', { timeout: 4_000 });
      }).toPass({ timeout: 60_000 });
      await expect(page.getByTestId('kt-status')).toContainText('Keys match the public key log');
    }
    // Owner monitoring: the log shows exactly Alice's own key and devices.
    await alice.getByTestId('nav-settings').click();
    await alice.getByTestId('settings-devices').click();
    await expect(alice.getByTestId('kt-self')).toHaveAttribute('data-status', 'verified', { timeout: 30_000 });
  } finally { await closeAll(alice, bob); }
});
