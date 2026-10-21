import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send } from './support';

/** COM-02 / specs §30.7: newcomer welcome, private checklist, versioned rules acknowledgement. */
async function openCommunity(page: Page, name: string) {
  await page.getByTestId('nav-communities').click();
  await page.getByTestId('community-row').filter({ hasText: name }).click({ timeout: 30_000 });
}

test('newcomers get a welcome, a private checklist and versioned rules to acknowledge', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const [ownerU, bobU] = await Promise.all(['oowner', 'obob'].map((p) => createUser(request, p)));
  const [owner, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU]] as const) await enroll(page, user);
    const name = `Makers ${Date.now() % 10000}`;
    await owner.getByTestId('nav-communities').click();
    await owner.getByTestId('new-community').click();
    await owner.getByTestId('community-name').fill(name);
    await owner.getByTestId('create-community').click();
    await expect(owner.getByTestId('community-title')).toHaveText(name, { timeout: 30_000 });
    // Bob joins the community; the owner then creates a group with Bob and links it.
    await owner.getByTestId('community-invite').click();
    await owner.getByTestId('add-member').click();
    await owner.getByTestId('people-search').fill(bobU.username);
    await owner.getByTestId(`pick-${bobU.username}`).click();
    await expect(owner.getByTestId(`member-${bobU.username}`)).toBeVisible({ timeout: 20_000 });
    await owner.getByTestId('nav-chats').click();
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    await owner.getByTestId('people-search').fill(bobU.username); await owner.getByTestId(`pick-${bobU.username}`).click();
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill('Workshop');
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'workshop open');
    await openCommunity(owner, name);
    await owner.getByTestId('community-add-group').click();
    await owner.getByTestId('community-pick-group').filter({ hasText: 'Workshop' }).click();
    await expect(owner.getByTestId('community-group').filter({ hasText: 'Workshop' })).toHaveAttribute('data-status', 'active', { timeout: 20_000 });

    // The owner writes the onboarding package.
    await owner.getByTestId('edit-onboarding').click();
    await owner.getByTestId('onboarding-welcome').fill('Hi! This is where makers meet.');
    await owner.getByTestId('onboarding-rules').fill('1. Be kind.\n2. No spam.');
    await owner.getByTestId('onboarding-rules-ack').check();
    await owner.getByTestId('onboarding-recommend').first().check();
    await owner.getByTestId('onboarding-save').click();
    await expect(owner.getByTestId('welcome-card').or(owner.getByTestId('show-welcome'))).toBeVisible({ timeout: 20_000 });

    await expect(async () => {
      await bob.getByTestId('nav-chats').click();
      await openCommunity(bob, name);
      await expect(bob.getByTestId('welcome-card')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    const card = bob.getByTestId('welcome-card');
    await expect(card.getByTestId('welcome-text')).toHaveText('Hi! This is where makers meet.');
    await expect(card.getByTestId('recommended-group')).toContainText('Workshop');
    const item = (id: string) => card.locator(`[data-item="${id}"]`);
    await expect(item('read-description')).toHaveAttribute('data-done', 'false');
    await item('read-description').locator('input').check();
    await expect(item('read-description')).toHaveAttribute('data-done', 'true');
    await card.getByTestId('rules-ack').click();
    // All required items done: the card collapses.
    await expect(bob.getByTestId('show-welcome')).toBeVisible({ timeout: 20_000 });

    // The reviewer sees the count for the current rules version.
    await openCommunity(owner, name);
    await owner.getByTestId('edit-onboarding').click();
    await expect(owner.getByTestId('rules-ack-count')).toHaveText('Rules version 1: acknowledged by 1 of 1', { timeout: 30_000 });

    // New rules version: Bob is asked again; his checklist progress stays.
    await owner.getByTestId('onboarding-rules').fill('1. Be kind.\n2. No spam.\n3. Tidy up after workshops.');
    await owner.getByTestId('onboarding-save').click();
    await expect(async () => {
      await bob.getByTestId('nav-chats').click();
      await openCommunity(bob, name);
      await expect(bob.getByTestId('rules-updated').first()).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await expect(bob.getByTestId('welcome-card').getByTestId('rules-ack')).toHaveText('I acknowledge the rules (version 2)');
    await expect(bob.getByTestId('welcome-card').locator('[data-item="read-description"]')).toHaveAttribute('data-done', 'true');

    // Progress survives a reload.
    await bob.reload({ waitUntil: 'domcontentloaded' });
    await expect(bob.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
    await openCommunity(bob, name);
    await expect(bob.getByTestId('welcome-card').locator('[data-item="read-description"]')).toHaveAttribute('data-done', 'true', { timeout: 20_000 });
  } finally { await closeAll(owner, bob); }
});
