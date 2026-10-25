import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, send, type TestUser } from './support';

/**
 * Specs §30.3 parent-removal delegation: removing someone from the community also removes them
 * from linked groups that accepted it (fan-out stops at once, a member commits the MLS removal);
 * groups that did not accept it are left alone.
 */
async function newGroup(page: Page, name: string, members: TestUser[]) {
  await page.getByTestId('nav-chats').click();
  await page.getByTestId('new-chat').click(); await page.getByTestId('new-group').click();
  for (const u of members) { await page.getByTestId('people-search').fill(u.username); await page.getByTestId(`pick-${u.username}`).click(); }
  await page.getByTestId('group-next').click(); await page.getByTestId('group-name').fill(name);
  await page.getByTestId('review-group').click(); await page.getByTestId('create-group').click();
  await send(page, `${name} is open`);
}

async function openCommunity(page: Page, name: string) {
  await page.getByTestId('nav-communities').click();
  await page.getByTestId('community-row').filter({ hasText: name }).click({ timeout: 30_000 });
}

test('community removal follows into delegating groups only', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const [ownerU, bobU, carolU] = await Promise.all(['rdowner', 'rdbob', 'rdcarol'].map((p) => createUser(request, p)));
  const [owner, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const name = `Site ${Date.now() % 10000}`;
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

    await newGroup(owner, 'Shift A', [bobU, carolU]);
    await newGroup(owner, 'Book club', [carolU]);
    await openCommunity(owner, name);
    await owner.getByTestId('community-add-group').click();
    await expect(owner.getByTestId('community-delegation-toggle')).toBeChecked();
    await owner.getByTestId('community-pick-group').filter({ hasText: 'Shift A' }).click();
    await owner.getByTestId('community-add-group').click();
    await owner.getByTestId('community-delegation-toggle').uncheck();
    await owner.getByTestId('community-pick-group').filter({ hasText: 'Book club' }).click();
    const group = (label: string) => owner.getByTestId('community-group').filter({ hasText: label });
    await expect(group('Shift A').getByTestId('community-delegation')).toBeVisible({ timeout: 20_000 });
    await expect(group('Book club').getByTestId('community-delegation')).toHaveCount(0);
    await openChat(carol, 'Shift A');

    // Remove Carol from the community (its announcements channel).
    await openCommunity(owner, name);
    await owner.getByTestId('community-invite').click();
    owner.once('dialog', (d) => void d.accept());
    await owner.getByTestId(`member-menu-${carolU.username}`).click();
    await owner.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    await expect(owner.getByTestId(`member-${carolU.username}`)).toHaveCount(0, { timeout: 20_000 });

    // Shift A: Carol is removed (a remaining member's client commits it); Book club keeps her.
    await expect(async () => {
      await openChat(owner, 'Shift A');
      await owner.getByTestId('thread-info').click();
      await expect(owner.getByTestId(`member-${carolU.username}`)).toHaveCount(0, { timeout: 3_000 });
    }).toPass({ timeout: 90_000 });
    await send(owner, 'Shift A after the removal');
    await openChat(owner, 'Book club');
    await owner.getByTestId('thread-info').click();
    await expect(owner.getByTestId(`member-${carolU.username}`)).toBeVisible();

    // Carol receives nothing new in Shift A.
    await openChat(bob, 'Shift A');
    await expect(bob.getByTestId('message-body').getByText('Shift A after the removal')).toBeVisible({ timeout: 30_000 });
    await carol.getByTestId('nav-chats').click();
    await openChat(carol, 'Shift A');
    await expect(carol.getByText('Shift A after the removal')).toHaveCount(0);

    // No membership operation is left pending.
    await openCommunity(owner, name);
    await expect(owner.locator('[data-testid="community-operation"][data-status="pending"]')).toHaveCount(0, { timeout: 30_000 });
  } finally { await closeAll(owner, bob, carol); }
});

/**
 * Specs §30.3: removing a subgroup's last owner from the community is blocked (never stranding the
 * group) and retried automatically once ownership is handed over.
 */
test('a blocked removal completes after the removed person hands over ownership', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const [ownerU, bobU, carolU] = await Promise.all(['rbowner', 'rbbob', 'rbcarol'].map((p) => createUser(request, p)));
  const [owner, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const name = `Depot ${Date.now() % 10000}`;
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
    await newGroup(owner, 'Night shift', [bobU, carolU]);
    await openCommunity(owner, name);
    await owner.getByTestId('community-add-group').click();
    await owner.getByTestId('community-pick-group').filter({ hasText: 'Night shift' }).click();
    await expect(owner.getByTestId('community-group').filter({ hasText: 'Night shift' }).getByTestId('community-delegation')).toBeVisible({ timeout: 20_000 });

    // The community owner hands Night shift to Carol and leaves it: Carol is its only owner.
    await openChat(owner, 'Night shift');
    await owner.getByTestId('thread-info').click();
    owner.once('dialog', (d) => void d.accept());
    await owner.getByTestId(`member-menu-${carolU.username}`).click();
    await owner.getByRole('menuitem', { name: 'Make owner' }).click();
    await expect(owner.getByTestId(`member-${carolU.username}`)).toContainText('Owner', { timeout: 20_000 });
    await owner.getByTestId('close-info').click();
    owner.once('dialog', (d) => void d.accept());
    await owner.getByTestId('thread-menu').click();
    await owner.getByTestId('menu-leave').click();
    await expect(owner.getByTestId('composer')).toHaveCount(0, { timeout: 20_000 });

    // Removing Carol from the community is blocked in Night shift.
    await openCommunity(owner, name);
    await owner.getByTestId('community-invite').click();
    owner.once('dialog', (d) => void d.accept());
    await owner.getByTestId(`member-menu-${carolU.username}`).click();
    await owner.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    await expect(owner.getByTestId(`member-${carolU.username}`)).toHaveCount(0, { timeout: 20_000 });
    await openCommunity(owner, name);
    await expect(owner.locator('[data-testid="community-operation"][data-status="blocked"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(owner.getByTestId('community-ops-retry')).toBeVisible();

    // Carol makes Bob owner: the removal is retried automatically and completes.
    await openChat(carol, 'Night shift');
    await carol.getByTestId('thread-info').click();
    carol.once('dialog', (d) => void d.accept());
    await carol.getByTestId(`member-menu-${bobU.username}`).click();
    await carol.getByRole('menuitem', { name: 'Make owner' }).click();
    await expect(async () => {
      await openCommunity(owner, name);
      await expect(owner.locator('[data-testid="community-operation"][data-status="blocked"]')).toHaveCount(0, { timeout: 3_000 });
    }).toPass({ timeout: 90_000 });
  } finally { await closeAll(owner, bob, carol); }
});
