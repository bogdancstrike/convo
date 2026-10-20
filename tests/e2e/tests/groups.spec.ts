import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send, startChat, messageMenu } from './support';

const openGroup = (page: Page, name: string) => openChat(page, name);

/**
 * GRP-02/03: MLS groups through the Delivery Service — encrypted name, authenticated senders,
 * admin add/remove, removed members stop receiving, new members get the name and new messages.
 */
test('create an MLS group, chat, remove and add members', async ({ browser, request }) => {
  const [ownerU, bobU, carolU, danU] = await Promise.all(['owner', 'bob', 'carol', 'dan'].map((p) => createUser(request, p)));
  const [owner, bob, carol, dan] = await Promise.all([1, 2, 3, 4].map(() => newPage(browser)));
  for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU], [dan, danU]] as const) await enroll(page, user);

  // A recent contact is immediately available in both member pickers.
  await startChat(owner, danU); await send(owner, 'Catch up soon');
  await owner.getByTestId('nav-chats').click();

  // Owner creates the group with Bob and Carol.
  const groupName = `Project Falcon ${Date.now() % 10000}`;
  await owner.getByTestId('new-chat').click();
  await owner.getByTestId('new-group').click();
  await expect(owner.getByTestId(`pick-${danU.username}`)).toBeVisible();
  for (const u of [bobU, carolU]) {
    await owner.getByTestId('people-search').fill(u.username);
    await owner.getByTestId(`pick-${u.username}`).click();
  }
  await owner.getByTestId('group-next').click();
  await owner.getByTestId('group-name').fill(groupName);
  await owner.getByTestId('review-group').click();
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
  await expect(owner.getByTestId('conversation-kind')).toHaveText('Group');
  owner.once('dialog', (d) => void d.accept());
  await owner.getByTestId(`member-menu-${carolU.username}`).click();
  await owner.getByRole('menuitem', { name: 'Remove', exact: true }).click();
  await expect(owner.getByTestId(`member-${carolU.username}`)).toHaveCount(0);

  // Owner adds Dan.
  await owner.getByTestId('add-member').click();
  await expect(owner.getByTestId('member-suggestions').getByTestId(`pick-${danU.username}`)).toBeVisible();
  await expect(owner.getByTestId('member-suggestions').getByTestId(`pick-${bobU.username}`)).toHaveCount(0);
  await owner.getByTestId(`pick-${danU.username}`).click();
  await expect(owner.getByTestId(`member-${danU.username}`)).toBeVisible();
  await owner.getByTestId(`member-menu-${bobU.username}`).click();
  await owner.getByRole('menuitem', { name: 'Make admin', exact: true }).click();
  await expect(owner.getByTestId(`member-${bobU.username}`)).toContainText('Admin');
  owner.once('dialog', (d) => void d.accept());
  await owner.getByTestId(`member-menu-${bobU.username}`).click();
  await owner.getByRole('menuitem', { name: 'Make owner', exact: true }).click();
  await expect(owner.getByTestId(`member-${bobU.username}`)).toContainText('Owner');
  await owner.getByTestId(`contact-${bobU.username}`).click();
  await expect(owner.getByTestId('participant-contact')).toContainText(bobU.name);
  await owner.getByTestId('open-shared-content').click();
  await owner.keyboard.press('Escape'); await expect(owner.getByTestId('participant-contact')).toBeVisible();
  await owner.keyboard.press('Escape'); await expect(owner.getByTestId('group-members')).toBeVisible();

  await owner.getByTestId('close-info').click();

  await expect(carol.getByText('You are no longer a member of this group')).toBeVisible();
  await send(owner, 'after the change');
  await expect(message(bob, 'after the change')).toBeVisible();
  await openGroup(dan, groupName);
  await expect(message(dan, 'after the change')).toBeVisible();
  await expect(message(carol, 'after the change')).toHaveCount(0);

  await expect(message(owner, 'after the change').getByTestId('message-status')).toHaveText('Received');
  const menu = await messageMenu(owner, 'after the change');
  await menu.getByRole('menuitem', { name: 'Message info', exact: true }).click();
  await expect(owner.getByRole('heading', { name: 'Delivered to', exact: true })).toBeVisible();
  await expect(owner.locator('.receipt-person')).toHaveCount(2);
  await owner.keyboard.press('Escape');
  for (const reader of [bob, dan]) {
    await reader.getByTestId('nav-settings').click(); await reader.getByTestId('settings-card-privacy').click();
    await reader.getByTestId('toggle-read-receipts').click(); await openGroup(reader, groupName);
  }
  await send(owner, 'Everyone has seen this');
  await expect(message(owner, 'Everyone has seen this').getByTestId('message-status')).toHaveText('Seen');
  await messageMenu(owner, 'Everyone has seen this'); await owner.getByRole('menuitem', { name: 'Message info', exact: true }).click();
  await expect(owner.getByTestId('read-by').locator('.receipt-person')).toHaveCount(2);
  await closeAll(owner, bob, carol, dan);
});
