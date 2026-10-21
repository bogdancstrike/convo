import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send, startChat } from './support';

async function adminSignIn(page: Page, user: { username: string; password: string }) {
  await page.goto('/admin');
  await page.getByTestId('admin-sign-in').click();
  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.locator('#kc-login').click();
}

/** ADM-01: role-gated admin console, disable/enable with reasons, verifiable audit chain. */
test('an organization admin disables and re-enables an account; the audit chain verifies', async ({ browser, request }) => {
  const adminU = await createUser(request, 'orgadmin', { realmRoles: ['convo-admin'] });
  const plainU = await createUser(request, 'notadmin');
  const memberU = await createUser(request, 'managed');
  const peerU = await createUser(request, 'managedpeer');
  const admin = await newPage(browser);
  const plain = await newPage(browser);
  const member = await newPage(browser);
  const peer = await newPage(browser);
  try {
    // No API access without the role, even with a valid organization token.
    expect((await request.get('/v1/admin/accounts')).status()).toBe(401);
    await adminSignIn(plain, plainU);
    await expect(plain.getByTestId('admin-name')).toBeVisible({ timeout: 30_000 });
    await expect(plain.getByTestId('admin-error')).toContainText('administrator role');

    await enroll(member, memberU);
    await enroll(peer, peerU);
    await adminSignIn(admin, adminU);
    await admin.getByTestId('admin-search').fill(memberU.username);
    const row = admin.getByTestId(`admin-account-${memberU.username}`);
    await expect(row.getByTestId('admin-status')).toHaveText('active');
    await expect(row.getByTestId('admin-devices')).toHaveText('1');

    admin.once('dialog', (d) => void d.accept(`policy review ${memberU.username}`));
    await row.getByTestId('admin-toggle-status').click();
    await expect(row.getByTestId('admin-status')).toHaveText('disabled');

    // A disabled account's device can no longer use the API.
    const denied = member.waitForResponse((r) => r.url().includes('/v1/') && r.status() === 403, { timeout: 30_000 });
    await member.reload({ waitUntil: 'domcontentloaded' });
    await denied;

    admin.once('dialog', (d) => void d.accept(`review closed ${memberU.username}`));
    await row.getByTestId('admin-toggle-status').click();
    await expect(row.getByTestId('admin-status')).toHaveText('active');

    await admin.getByTestId('admin-tab-audit').click();
    await expect(admin.getByTestId('admin-audit-entry').filter({ hasText: `policy review ${memberU.username}` })).toContainText('account.disable');
    await expect(admin.getByTestId('admin-audit-entry').filter({ hasText: `review closed ${memberU.username}` })).toContainText('account.enable');
    await admin.getByTestId('admin-verify').click();
    await expect(admin.getByTestId('admin-verification')).toContainText('Chain intact');
    await admin.getByTestId('admin-checkpoint').click();
    await expect(admin.getByTestId('admin-verification')).toContainText(/independent checkpoint\(s\) match/);

    // Re-enabled accounts work again.
    await member.reload({ waitUntil: 'domcontentloaded' });
    await expect(member.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
    await startChat(member, peerU, peerU.name);
    await send(member, 'back online');
  } finally { await closeAll(admin, plain, member, peer); }
});
