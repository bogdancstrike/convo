import { expect, test } from '@playwright/test';
import { adminSignIn, closeAll, confirmReason, createUser, enroll, newPage } from './support';

/**
 * A device unlinked while its tab was closed never receives the socket's revocation notice. When it
 * opens again it must learn it was signed out (and wipe its data) instead of staying "signed in"
 * with every request failing: history "could not sync", no messages, logout refused.
 */
test('a device revoked while closed is told so when it opens again', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [personU, adminU] = await Promise.all([createUser(request, 'revoff'), createUser(request, 'revoffadm', { realmRoles: ['convo-helpdesk'] })]);
  const [person, admin] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    await enroll(person, personU);
    const context = person.context();
    await person.close(); // the tab is closed: no socket to deliver the revocation

    await adminSignIn(admin, adminU);
    await admin.getByTestId('admin-tab-users').click();
    await admin.getByTestId('admin-search').fill(personU.username);
    await admin.getByTestId(`admin-account-${personU.username}`).getByRole('button', { name: personU.name, exact: true }).click();
    await admin.getByTestId('user-drawer').getByRole('tab', { name: /Devices/ }).click();
    await admin.getByTestId('admin-device-list').getByTestId('admin-revoke').first().click();
    await confirmReason(admin, 'lost laptop');
    await expect(admin.getByTestId('admin-device-list').getByTestId('admin-revoke')).toHaveCount(0, { timeout: 20_000 });

    const reopened = await context.newPage();
    await reopened.goto('/');
    await expect(reopened.getByText('This browser was signed out')).toBeVisible({ timeout: 45_000 });
  } finally { await closeAll(admin); }
});
