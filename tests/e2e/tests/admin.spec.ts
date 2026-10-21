import { expect, test } from '@playwright/test';
import { ADMIN_URL, adminSignIn, closeAll, confirmReason, createUser, enroll, newPage, send, startChat , adminGo } from './support';

/**
 * ADM-01: the admin console runs on its own origin and requires an admin role; disabling an
 * account blocks its devices at once; every change is in the verifiable audit chain.
 */
test('the console needs an admin role; disable/enable takes effect and is audited', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const adminU = await createUser(request, 'orgadmin', { realmRoles: ['convo-admin'] });
  const plainU = await createUser(request, 'notadmin');
  const memberU = await createUser(request, 'managed');
  const peerU = await createUser(request, 'managedpeer');
  const [admin, plain, member, peer] = await Promise.all([1, 2, 3, 4].map(() => newPage(browser)));
  try {
    // The messenger origin serves no admin UI; the admin API refuses callers without a role.
    expect((await request.get('/admin')).status()).toBe(404);
    expect((await request.get(`${ADMIN_URL}/v1/admin/accounts`)).status()).toBe(401);
    expect((await request.get(`${ADMIN_URL}/v1/deployment-info`)).status()).toBe(404);
    await adminSignIn(plain, plainU);
    await expect(plain.getByTestId('admin-no-role')).toContainText('administrator role');

    await enroll(member, memberU);
    await enroll(peer, peerU);
    await adminSignIn(admin, adminU);
    await admin.getByTestId('admin-tab-users').click();
    await admin.getByTestId('admin-search').fill(memberU.username);
    const row = admin.getByTestId(`admin-account-${memberU.username}`);
    await expect(row.getByTestId('admin-status')).toHaveText('active');
    await expect(row.getByTestId('admin-devices')).toHaveText('1');
    await row.click();
    const drawer = admin.getByTestId('user-drawer');
    await drawer.getByRole('tab', { name: 'Security' }).click();
    await drawer.getByTestId('admin-toggle-status').click();
    await confirmReason(admin, `policy review ${memberU.username}`);
    await expect(drawer.getByText('Disabled').first()).toBeVisible();

    // A disabled account's device can no longer use the API.
    const denied = member.waitForResponse((r) => r.url().includes('/v1/') && r.status() === 403, { timeout: 30_000 });
    await member.reload({ waitUntil: 'domcontentloaded' });
    await denied;

    await drawer.getByTestId('admin-toggle-status').click();
    await confirmReason(admin, `review closed ${memberU.username}`);
    await expect(drawer.getByTestId('admin-toggle-status')).toHaveText(/Disable account/);
    await adminGo(admin, 'audit');
    await expect(admin.getByTestId('admin-audit-entry').filter({ hasText: `policy review ${memberU.username}` })).toContainText('account.disable');
    await expect(admin.getByTestId('admin-audit-entry').filter({ hasText: `review closed ${memberU.username}` })).toContainText('account.enable');
    await expect(admin.getByTestId('admin-audit-entry').filter({ hasText: 'admin.session' }).first()).toBeVisible();
    await admin.getByTestId('admin-verify').click();
    await expect(admin.getByTestId('admin-verification')).toContainText('Chain intact');
    await admin.getByTestId('admin-checkpoint').click();
    await expect(admin.getByTestId('admin-verification')).toContainText(/checkpoints match/);

    // Re-enabled accounts work again.
    await member.reload({ waitUntil: 'domcontentloaded' });
    await expect(member.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
    await startChat(member, peerU, peerU.name);
    await send(member, 'back online');
  } finally { await closeAll(admin, plain, member, peer); }
});
