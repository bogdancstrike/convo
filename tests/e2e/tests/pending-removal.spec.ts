import { expect, test } from '@playwright/test';
import { adminSignIn, closeAll, confirmReason, createUser, enroll, message, newPage, send } from './support';

/**
 * Specs §4.7 pending-removal gate: after a member's device is revoked, the server accepts no group
 * messages until its MLS leaf is removed. A plain member's message waits; the owner's client removes
 * the revoked leaf, and then both messages are delivered.
 */
test('a revoked device blocks group messages until an owner removes it', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const [ownerU, bobU, carolU, adminU] = await Promise.all([createUser(request, 'prowner'), createUser(request, 'prbob'), createUser(request, 'prcarol'),
    createUser(request, 'pradmin', { realmRoles: ['convo-helpdesk'] })]);
  const [owner, bob, carol, admin] = await Promise.all([1, 2, 3, 4].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const groupName = `Removal ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    for (const u of [bobU, carolU]) { await owner.getByTestId('people-search').fill(u.username); await owner.getByTestId(`pick-${u.username}`).click(); }
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'before revocation');
    await carol.getByTestId('nav-chats').click();
    await carol.locator('.chat-row > button.row').filter({ hasText: groupName }).click();
    await expect(message(carol, 'before revocation')).toBeVisible({ timeout: 20_000 });

    // Helpdesk revokes Bob's only device (lost phone).
    await adminSignIn(admin, adminU);
    await admin.getByTestId('admin-tab-users').click();
    await admin.getByTestId('admin-search').fill(bobU.username);
    await admin.getByTestId(`admin-account-${bobU.username}`).getByRole('button', { name: bobU.name, exact: true }).click();
    await admin.getByTestId('user-drawer').getByRole('tab', { name: /Devices/ }).click();
    await admin.getByTestId('admin-device-list').getByTestId('admin-revoke').first().click();
    await confirmReason(admin, 'lost phone');
    await expect(admin.getByTestId('admin-device-list').getByTestId('admin-revoke')).toHaveCount(0, { timeout: 20_000 });

    // Carol (member) cannot remove someone else's device: her message waits.
    await send(carol, 'waiting for removal');
    await owner.waitForTimeout(5000);
    await expect(message(owner, 'waiting for removal')).toHaveCount(0);

    // The owner's next message triggers the removal; then everything is delivered.
    await send(owner, 'after revocation');
    await expect(message(carol, 'after revocation')).toBeVisible({ timeout: 45_000 });
    await expect(message(owner, 'waiting for removal')).toBeVisible({ timeout: 60_000 });
  } finally { await closeAll(owner, bob, carol, admin); }
});
