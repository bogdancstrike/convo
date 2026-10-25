import { expect, test, type Page } from '@playwright/test';
import { adminSignIn, closeAll, confirmReason, createUser, enroll, newPage } from './support';

/**
 * FR-EXT-01 guest invitations: administrators create time-limited guest accounts or set guest access
 * on an existing one; Convo labels guests "Guest" everywhere people decide what to share. Automatic
 * expiry (sign-in and Convo account disabled) is covered by GuestAccountsTest.
 */
async function openUser(admin: Page, username: string) {
  await admin.getByTestId('admin-tab-users').click();
  await admin.getByTestId('admin-search').fill(username);
  await admin.getByTestId(`idp-user-${username}`).or(admin.getByTestId(`admin-account-${username}`)).getByRole('button').first().click();
  return admin.getByTestId('user-drawer');
}

test('admin creates a guest account with an expiry', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const adminU = await createUser(request, 'guestadmin', { realmRoles: ['convo-admin'] });
  const admin = await newPage(browser);
  try {
    await adminSignIn(admin, adminU);
    const username = `guest-${Date.now() % 100000}`;
    await admin.getByTestId('admin-tab-users').click();
    await admin.getByTestId('admin-create-user').click();
    await admin.getByTestId('create-username').fill(username);
    await admin.getByTestId('create-first').fill('Visiting');
    await admin.getByTestId('create-guest').check();
    await expect(admin.getByTestId('create-phone')).toHaveCount(0);
    await admin.getByTestId('create-guest-days').fill('14');
    await admin.getByTestId('create-reason').fill('external auditor');
    await admin.getByTestId('create-user-submit').click();
    await expect(admin.getByText(/Guest access ends/)).toBeVisible();
    await admin.getByRole('button', { name: 'OK' }).click();
    await expect(admin.getByTestId('user-drawer').getByTestId('guest-status')).toContainText('Guest until');
  } finally { await closeAll(admin); }
});

test('guest access on an existing account shows a Guest label to other people', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const [adminU, carolU, bobU] = await Promise.all([createUser(request, 'guestadm2', { realmRoles: ['convo-admin'] }), createUser(request, 'guestcarol'), createUser(request, 'guestbob')]);
  const [admin, carol, bob] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    await enroll(carol, carolU); await enroll(bob, bobU);
    await bob.getByTestId('new-chat').click();
    await bob.getByTestId('directory-search').fill(carolU.username);
    await expect(bob.getByTestId(`directory-${carolU.username}`)).toBeVisible();
    await expect(bob.getByTestId(`directory-${carolU.username}`).getByTestId('guest-badge')).toHaveCount(0);

    await adminSignIn(admin, adminU);
    const drawer = await openUser(admin, carolU.username);
    await drawer.getByRole('tab', { name: 'Security' }).click();
    await drawer.getByTestId('signin-guest').click();
    await admin.getByRole('menuitem', { name: '30 days from now' }).click();
    await confirmReason(admin, 'contractor for one month');
    await expect(admin.getByText('Guest access set')).toBeVisible();

    // Directory results are fresh per search; the cached contact entry is not reused here.
    await bob.getByTestId('directory-search').fill('');
    await bob.getByTestId('directory-search').fill(carolU.username);
    await expect(bob.getByTestId(`directory-${carolU.username}`).getByTestId('guest-badge')).toBeVisible({ timeout: 20_000 });
  } finally { await closeAll(admin, carol, bob); }
});
