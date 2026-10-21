import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send, startChat } from './support';

/** Specs §30.8: member search with All/Admins filters, groups in common (local only). */
test('search group members, filter admins, and see groups in common', async ({ browser, request }) => {
  const [ownerU, bobU, carolU] = await Promise.all(['msowner', 'msbob', 'mscarol'].map((p) => createUser(request, p)));
  const [owner, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const groupName = `Roster ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    for (const u of [bobU, carolU]) { await owner.getByTestId('people-search').fill(u.username); await owner.getByTestId(`pick-${u.username}`).click(); }
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'roster ready');
    await owner.getByTestId('thread-info').click();
    await owner.getByTestId(`member-menu-${bobU.username}`).click();
    await owner.getByRole('menuitem', { name: 'Make admin', exact: true }).click();
    await expect(owner.getByTestId(`member-${bobU.username}`)).toContainText('Admin', { timeout: 20_000 });

    await expect(owner.getByTestId('member-count')).toHaveText('3 of 3 members');
    await owner.getByTestId('member-search').fill(carolU.name.toUpperCase());
    await expect(owner.getByTestId('member-count')).toHaveText('1 of 3 members');
    await expect(owner.getByTestId(`member-${carolU.username}`)).toBeVisible();
    await expect(owner.getByTestId(`member-${bobU.username}`)).toHaveCount(0);
    await owner.getByTestId('member-search').fill('');
    await owner.getByTestId('member-filter-admins').click();
    await expect(owner.getByTestId('member-count')).toHaveText('2 of 3 members'); // owner + admin
    await expect(owner.getByTestId(`member-${carolU.username}`)).toHaveCount(0);

    // Groups in common, from a direct chat's info.
    await startChat(owner, carolU, carolU.name);
    await owner.getByTestId('thread-info').click();
    await expect(owner.getByTestId('common-groups').locator('h4')).toHaveText('Groups in common (1)');
    await owner.getByTestId('common-group').filter({ hasText: groupName }).click();
    await expect(owner.getByTestId('composer')).toBeVisible();
  } finally { await closeAll(owner, bob, carol); }
});
