import { expect, test, type Page } from '@playwright/test';
import { adminGo, adminSignIn, closeAll, confirmReason, createUser, enroll, newPage, startChat } from './support';

/**
 * AC-ADM-02: an administrator publishes a signed policy; devices verify and enforce it. The policy is
 * deployment-wide, so this test only turns off chat export (no other test uses it) and restores the
 * defaults before it ends.
 */
async function publish(admin: Page, exportOn: boolean, reason: string) {
  await adminGo(admin, 'policy');
  const toggle = admin.getByTestId('policy-features-chatExport');
  if ((await toggle.getAttribute('aria-checked')) !== String(exportOn)) await toggle.click();
  await admin.getByTestId('policy-publish').click();
  await confirmReason(admin, reason);
  await expect(admin.getByText(/Policy version \d+ published/)).toBeVisible({ timeout: 20_000 });
}

test('a published policy is verified and enforced by devices; settings show the version', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const [adminU, amyU, bobU] = await Promise.all([createUser(request, 'poladmin', { realmRoles: ['convo-admin'] }), createUser(request, 'polamy'), createUser(request, 'polbob')]);
  const [admin, amy] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    await adminSignIn(admin, adminU);
    await publish(admin, false, 'no readable exports');
    await expect(admin.getByTestId('policy-version')).toContainText('Signing key');

    // A device that starts now fetches, verifies and applies it.
    await enroll(amy, amyU);
    const bob = await newPage(browser); await enroll(bob, bobU); await bob.close();
    await startChat(amy, bobU);
    await amy.getByTestId('thread-info').click();
    await expect(amy.getByTestId('close-info')).toBeVisible();
    await expect(amy.getByTestId('export-chat')).toHaveCount(0);
    await amy.getByTestId('nav-settings').click(); await amy.getByTestId('settings-card-privacy').click();
    await expect(amy.getByTestId('policy-version')).toContainText(/Policy version \d+ · key [0-9a-f]{16}/);
    await expect(amy.getByTestId('policy-rejected')).toHaveCount(0);
  } finally {
    await publish(admin, true, 'restore defaults after test').catch(() => undefined);
    await closeAll(admin, amy);
  }
});
