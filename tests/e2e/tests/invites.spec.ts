import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send } from './support';

/** GRP-03: invite links and admin-approved join requests. */
test('join a group through an invite link after admin approval; reset links invalidate old ones', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [ownerU, bobU, carolU, danU] = await Promise.all(['iowner', 'ibob', 'icarol', 'idan'].map((p) => createUser(request, p)));
  const [owner, carol, dan] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  const bob = await newPage(browser);
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU], [dan, danU]] as const) await enroll(page, user);
    const groupName = `Invited ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    await owner.getByTestId('people-search').fill(bobU.username); await owner.getByTestId(`pick-${bobU.username}`).click();
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'hello group');

    await owner.getByTestId('thread-info').click();
    await owner.getByTestId('create-invite').click();
    const url = await owner.getByTestId('invite-link').inputValue();
    expect(url).toMatch(/#\/join\/[A-Za-z0-9_-]{32}$/);

    await carol.goto(url);
    await expect(carol.getByTestId('join-dialog')).toBeVisible({ timeout: 45_000 });
    await expect(carol.getByTestId('join-dialog')).not.toContainText(groupName);
    await carol.getByTestId('join-request-send').click();
    await expect(carol.getByTestId('join-dialog')).toContainText('Request sent');
    await carol.getByTestId('join-close').click();

    const requestRow = owner.getByTestId('join-request').filter({ hasText: carolU.name });
    await expect(requestRow).toBeVisible({ timeout: 20_000 });
    await requestRow.getByTestId('approve-join').click();
    await expect(owner.getByTestId('join-request')).toHaveCount(0, { timeout: 20_000 });
    await expect(carol.locator('.chat-row').filter({ hasText: groupName })).toBeVisible({ timeout: 30_000 });

    await owner.getByTestId('revoke-invites').click();
    await expect(owner.getByTestId('invite-link')).toHaveCount(0); // revoked on the server before Dan tries
    await dan.goto(url);
    await expect(dan.getByTestId('join-dialog')).toBeVisible({ timeout: 45_000 });
    await dan.getByTestId('join-request-send').click();
    await expect(dan.getByTestId('join-dialog')).toContainText('no longer valid');

    // Ban: removes Carol and refuses her requests through new links until unbanned.
    owner.once('dialog', (d) => void d.accept());
    await owner.getByTestId(`member-menu-${carolU.username}`).click();
    await owner.getByTestId('member-ban').click();
    await expect(owner.getByTestId('banned-member').filter({ hasText: carolU.name })).toBeVisible({ timeout: 20_000 });
    await owner.getByTestId('create-invite').click();
    const second = await owner.getByTestId('invite-link').inputValue();
    await carol.goto(second);
    await expect(carol.getByTestId('join-dialog')).toBeVisible({ timeout: 45_000 });
    await carol.getByTestId('join-request-send').click();
    await expect(carol.getByTestId('join-dialog')).toContainText('no longer valid');
    await owner.getByTestId('unban').click();
    await expect(owner.getByTestId('banned-member')).toHaveCount(0);
  } finally { await closeAll(owner, bob, carol, dan); }
});
