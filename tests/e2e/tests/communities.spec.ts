import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, send, type TestUser } from './support';

/**
 * COM-01/02 slice 1: create a community (announcement channel), add members, link groups with
 * both authorities, discover a group and ask to join it; private groups stay hidden.
 */
async function newGroup(page: Page, name: string, members: TestUser[]) {
  await page.getByTestId('nav-chats').click();
  await page.getByTestId('new-chat').click();
  await page.getByTestId('new-group').click();
  for (const u of members) {
    await page.getByTestId('people-search').fill(u.username);
    await page.getByTestId(`pick-${u.username}`).click();
  }
  await page.getByTestId('group-next').click();
  await page.getByTestId('group-name').fill(name);
  await page.getByTestId('review-group').click();
  await page.getByTestId('create-group').click();
  await send(page, `${name} says hi`);
}

async function openCommunity(page: Page, name: string) {
  await page.getByTestId('nav-communities').click();
  await page.getByTestId('community-row').filter({ hasText: name }).click({ timeout: 30_000 });
  await expect(page.getByTestId('community-title')).toHaveText(name);
}

const group = (page: Page, name: string) => page.getByTestId('community-group').filter({ hasText: name });

test('communities: create, link groups with consent, discover and ask to join', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const [ownerU, bobU, carolU] = await Promise.all(['cowner', 'cbob', 'ccarol'].map((p) => createUser(request, p)));
  const [owner, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const name = `Ops ${Date.now() % 10000}`;

    // Create the community; its announcements are an admin-only channel.
    await owner.getByTestId('nav-communities').click();
    await owner.getByTestId('new-community').click();
    await owner.getByTestId('community-name').fill(name);
    await owner.getByTestId('community-description').fill('Operations updates and teams');
    await owner.getByTestId('create-community').click();
    await expect(owner.getByTestId('community-title')).toHaveText(name, { timeout: 30_000 });
    await expect(owner.getByTestId('community-about')).toHaveText('Operations updates and teams');

    // Add Bob and Carol to the community (announcement channel members).
    await owner.getByTestId('community-invite').click();
    for (const u of [bobU, carolU]) {
      await owner.getByTestId('add-member').click();
      await owner.getByTestId('people-search').fill(u.username);
      await owner.getByTestId(`pick-${u.username}`).click();
      await expect(owner.getByTestId(`member-${u.username}`)).toBeVisible({ timeout: 20_000 });
    }
    await send(owner, 'Welcome to the community');

    // A group the owner owns is linked at once (discoverable); a private one stays hidden.
    await newGroup(owner, 'Night shift', [bobU]);
    await newGroup(owner, 'Leads only', [bobU]);
    await openCommunity(owner, name);
    for (const [label, visibility] of [['Night shift', 'discoverable'], ['Leads only', 'private']] as const) {
      await owner.getByTestId('community-add-group').click();
      await owner.getByTestId(`community-visibility-${visibility}`).check();
      await owner.getByTestId('community-pick-group').filter({ hasText: label }).click();
      await expect(group(owner, label)).toHaveAttribute('data-status', 'active', { timeout: 20_000 });
    }

    // A group Bob owns needs Bob's acceptance after the admin proposes it.
    await newGroup(bob, 'Bob’s crew', [ownerU]);
    await openChat(owner, 'Bob’s crew');
    await openCommunity(owner, name);
    await owner.getByTestId('community-add-group').click();
    await owner.getByTestId('community-pick-group').filter({ hasText: 'Bob’s crew' }).click();
    await expect(group(owner, 'Bob’s crew')).toHaveAttribute('data-status', 'proposed', { timeout: 20_000 });
    await openCommunity(bob, name);
    await group(bob, 'Bob’s crew').getByTestId('community-accept').click();
    await expect(group(bob, 'Bob’s crew')).toHaveAttribute('data-status', 'active', { timeout: 20_000 });

    // Carol (community member, in no group) sees the discoverable groups by name, not the private one.
    await openCommunity(owner, name); // a community admin in the group publishes its encrypted label
    await expect(group(owner, 'Bob’s crew')).toHaveAttribute('data-status', 'active');
    await expect(async () => {
      await carol.getByTestId('nav-chats').click();
      await openCommunity(carol, name);
      await expect(group(carol, 'Night shift')).toBeVisible({ timeout: 3_000 });
      await expect(group(carol, 'Bob’s crew')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await expect(carol.getByTestId('community-group')).toHaveCount(2);
    await expect(carol.getByText('Leads only')).toHaveCount(0);
    await expect(carol.getByTestId('community-add-group')).toHaveCount(0);

    // Carol asks to join; the group owner approves the request as usual.
    await group(carol, 'Night shift').getByTestId('community-join').click();
    await expect(group(carol, 'Night shift').getByTestId('community-requested')).toBeVisible();
    await openChat(owner, 'Night shift');
    await owner.getByTestId('thread-info').click();
    const requestRow = owner.getByTestId('join-request').filter({ hasText: carolU.name });
    await expect(requestRow).toBeVisible({ timeout: 20_000 });
    await requestRow.getByTestId('approve-join').click();
    await expect(async () => {
      await carol.getByTestId('nav-chats').click();
      await openCommunity(carol, name);
      await expect(group(carol, 'Night shift')).toHaveAttribute('data-member', 'true', { timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await group(carol, 'Night shift').locator('button.row').click();
    await expect(carol.getByTestId('composer')).toBeVisible({ timeout: 20_000 });

    // Announcements reach members; members cannot post there.
    await openCommunity(carol, name);
    await expect(carol.getByTestId('community-announcements')).toBeEnabled({ timeout: 30_000 });
    await carol.getByTestId('community-announcements').click();
    await expect(carol.getByTestId('message-body').getByText('Welcome to the community')).toBeVisible({ timeout: 20_000 });
    await expect(carol.getByTestId('composer')).toHaveCount(0);
  } finally { await closeAll(owner, bob, carol); }
});

test('groups are created directly inside a community, with chosen community members', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const [ownerU, bobU, carolU] = await Promise.all(['gowner', 'gbob', 'gcarol'].map((p) => createUser(request, p)));
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
    await openCommunity(owner, name);

    // New group in the community: Bob picked, Carol not; visible in the community.
    await owner.getByTestId('community-new-group').click();
    await owner.getByTestId('community-group-name').fill('Field team');
    await owner.getByTestId('community-group-description').fill('Daily coordination');
    await owner.locator('.community-member-picker label').filter({ hasText: bobU.name }).getByTestId('community-member-pick').check();
    await owner.getByTestId('community-create-group-submit').click();
    // It opens straight away and is already part of the community (no acceptance step).
    await expect(owner.getByTestId('composer')).toBeVisible({ timeout: 30_000 });
    await send(owner, 'Field team kickoff');
    await openCommunity(owner, name);
    await expect(group(owner, 'Field team')).toHaveAttribute('data-status', 'active');

    // Bob was added: he reads the group. Carol can see it in the community and ask to join.
    await openChat(bob, 'Field team');
    await expect(bob.getByTestId('message-body').getByText('Field team kickoff')).toBeVisible({ timeout: 30_000 });
    await openCommunity(carol, name);
    await expect(group(carol, 'Field team').getByTestId('community-join')).toBeVisible({ timeout: 30_000 });
  } finally { await closeAll(owner, bob, carol); }
});
