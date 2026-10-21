import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, message, messageMenu, newPage, openChat, send } from './support';

/**
 * COM-02 / specs §30.6: explicit announcement acknowledgements. Read receipts stay off (the
 * default); only the deliberate button responds, privately to the named reviewers.
 */
async function openAnnouncements(page: Page, community: string) {
  await page.getByTestId('nav-communities').click();
  await page.getByTestId('community-row').filter({ hasText: community }).click({ timeout: 30_000 });
  await expect(page.getByTestId('community-announcements')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('community-announcements').click();
}

test('members acknowledge an announcement explicitly; edits ask again', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const [ownerU, bobU, carolU] = await Promise.all(['aowner', 'abob', 'acarol'].map((p) => createUser(request, p)));
  const [owner, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const name = `Policies ${Date.now() % 10000}`;
    await owner.getByTestId('nav-communities').click();
    await owner.getByTestId('new-community').click();
    await owner.getByTestId('community-name').fill(name);
    await owner.getByTestId('create-community').click();
    await expect(owner.getByTestId('community-title')).toHaveText(name, { timeout: 30_000 });
    await owner.getByTestId('community-invite').click();
    for (const u of [bobU, carolU]) {
      await owner.getByTestId('add-member').click();
      await owner.getByTestId('people-search').fill(u.username);
      await owner.getByTestId(`pick-${u.username}`).click();
      await expect(owner.getByTestId(`member-${u.username}`)).toBeVisible({ timeout: 20_000 });
    }
    await send(owner, 'Welcome');

    // The owner posts a policy update asking for acknowledgement.
    await owner.getByTestId('request-ack').check();
    await send(owner, 'New travel policy applies from Monday');
    const ownPost = message(owner, 'New travel policy applies from Monday');
    await expect(ownPost.getByTestId('ack-count')).toHaveText('Acknowledged 0 of 2');

    // Bob sees who receives his response and acknowledges deliberately.
    await openAnnouncements(bob, name);
    const bobPost = message(bob, 'New travel policy applies from Monday');
    await expect(bobPost.getByTestId('ack-reviewers')).toContainText(ownerU.name, { timeout: 20_000 });
    await expect(bob.getByTestId('composer')).toHaveCount(0); // a response is not a post
    await bobPost.getByTestId('ack-button').click();
    await expect(bobPost.getByTestId('ack-state')).toHaveAttribute('data-state', 'sent', { timeout: 20_000 });
    await expect(ownPost.getByTestId('ack-count')).toHaveText('Acknowledged 1 of 2', { timeout: 30_000 });
    await ownPost.getByTestId('ack-count').click();
    await expect(ownPost.getByTestId('ack-list').locator('li[data-state="acknowledged"]')).toHaveText(new RegExp(bobU.name));
    await expect(ownPost.getByTestId('ack-list').locator('li[data-state="pending"]')).toHaveText(new RegExp(carolU.name));

    // Carol only reads it (opening is not acknowledging).
    await openAnnouncements(carol, name);
    await expect(message(carol, 'New travel policy applies from Monday').getByTestId('ack-button')).toBeVisible({ timeout: 20_000 });
    await expect(ownPost.getByTestId('ack-count')).toHaveText('Acknowledged 1 of 2');

    // Editing the announcement invalidates earlier acknowledgements.
    await (await messageMenu(owner, 'New travel policy applies from Monday')).getByTestId('action-edit').click();
    await owner.getByTestId('composer').fill('New travel policy applies from Tuesday');
    await owner.getByTestId('send').click();
    await expect(message(owner, 'New travel policy applies from Tuesday').getByTestId('ack-count')).toHaveText('Acknowledged 0 of 2');
    const bobEdited = message(bob, 'New travel policy applies from Tuesday');
    await expect(bobEdited.getByTestId('ack-updated')).toBeVisible({ timeout: 30_000 });
    await bobEdited.getByTestId('ack-button').click();
    await expect(message(owner, 'New travel policy applies from Tuesday').getByTestId('ack-count')).toHaveText('Acknowledged 1 of 2', { timeout: 30_000 });
  } finally { await closeAll(owner, bob, carol); }
});
