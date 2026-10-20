import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send } from './support';

const openGroup = (page: Page, name: string) => openChat(page, name);

/**
 * GRP-02/03: MLS groups through the Delivery Service — encrypted name, authenticated senders,
 * admin add/remove, removed members stop receiving, new members get the name and new messages.
 */
test('create an MLS group, chat, remove and add members', async ({ browser, request }) => {
  const [ownerU, bobU, carolU, danU] = await Promise.all(['owner', 'bob', 'carol', 'dan'].map((p) => createUser(request, p)));
  const [owner, bob, carol, dan] = await Promise.all([1, 2, 3, 4].map(() => newPage(browser)));
  for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU], [dan, danU]] as const) await enroll(page, user);

  // Owner creates the group with Bob and Carol.
  const groupName = `Project Falcon ${Date.now() % 10000}`;
  await owner.getByTestId('new-chat').click();
  await owner.getByTestId('new-group').click();
  for (const u of [bobU, carolU]) {
    await owner.getByTestId('people-search').fill(u.username);
    await owner.getByTestId(`pick-${u.username}`).click();
  }
  await owner.getByTestId('group-next').click();
  await owner.getByTestId('group-name').fill(groupName);
  await owner.getByTestId('create-group').click();
  await expect(owner.getByTestId('thread-title')).toHaveText(groupName);

  // Members receive the Welcome and the encrypted group name.
  await openGroup(bob, groupName);
  await openGroup(carol, groupName);

  await send(owner, 'kick-off at 10');
  await expect(message(bob, 'kick-off at 10')).toBeVisible();
  await expect(message(carol, 'kick-off at 10')).toBeVisible();

  // Authenticated sender names are shown to other members.
  await send(bob, 'bob here');
  const atCarol = message(carol, 'bob here');
  await expect(atCarol).toBeVisible();
  await expect(atCarol.getByTestId('message-author')).toHaveText(bobU.name);
  await expect(message(owner, 'bob here')).toBeVisible();

  // Owner removes Carol: she is told and receives nothing new.
  await owner.getByTestId('thread-info').click();
  owner.once('dialog', (d) => void d.accept());
  await owner.getByTestId(`member-${carolU.username}`).getByRole('button', { name: 'Remove' }).click();
  await expect(owner.getByTestId(`member-${carolU.username}`)).toHaveCount(0);

  // Owner adds Dan.
  await owner.getByTestId('add-member').click();
  await owner.getByTestId('people-search').fill(danU.username);
  await owner.getByTestId(`pick-${danU.username}`).click();
  await expect(owner.getByTestId(`member-${danU.username}`)).toBeVisible();
  await owner.getByTestId('close-info').click();

  await expect(carol.getByText('You are no longer a member of this group')).toBeVisible();
  await send(owner, 'after the change');
  await expect(message(bob, 'after the change')).toBeVisible();
  await openGroup(dan, groupName);
  await expect(message(dan, 'after the change')).toBeVisible();
  await expect(message(carol, 'after the change')).toHaveCount(0);

  await closeAll(owner, bob, carol, dan);
});
