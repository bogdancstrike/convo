import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send, startChat } from './support';

/** Specs §30.4: private chat folders with explicit chats, type filters, edit and delete. */
test('chat folders filter the list by chosen chats and types; edit and delete', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [meU, bobU, carolU] = await Promise.all(['folders', 'fbob', 'fcarol'].map((p) => createUser(request, p)));
  const [me, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    await Promise.all([enroll(me, meU), enroll(bob, bobU), enroll(carol, carolU)]);
    await startChat(me, bobU, bobU.name); await send(me, 'hi bob');
    await startChat(me, carolU, carolU.name); await send(me, 'hi carol');
    const groupName = `Folder group ${Date.now() % 10000}`;
    await me.getByTestId('new-chat').click(); await me.getByTestId('new-group').click();
    await me.getByTestId('people-search').fill(bobU.username); await me.getByTestId(`pick-${bobU.username}`).click();
    await me.getByTestId('group-next').click(); await me.getByTestId('group-name').fill(groupName);
    await me.getByTestId('review-group').click(); await me.getByTestId('create-group').click();
    await send(me, 'group hello');

    await me.getByTestId('folder-add').click();
    await me.getByTestId('folder-name').fill('Work');
    await me.getByTestId('folder-type-group').check();
    await me.getByTestId(`folder-chat-${bobU.name}`).check();
    await me.getByTestId('folder-save').click();
    await me.getByTestId('folder-Work').click();
    const list = me.locator('.panel-body');
    await expect(list).toContainText(bobU.name);
    await expect(list).toContainText(groupName);
    await expect(list).not.toContainText(carolU.name);

    // Edit: drop groups, keep Bob.
    await me.getByTestId('folder-Work').click({ button: 'right' });
    await me.getByTestId('folder-type-group').uncheck();
    await me.getByTestId('folder-name').fill('Bob only');
    await me.getByTestId('folder-save').click();
    await me.getByTestId('folder-Bob only').click();
    await expect(list).toContainText(bobU.name);
    await expect(list).not.toContainText(groupName);

    // Survives a reload (stored encrypted on the device), then delete.
    await me.reload();
    await me.getByTestId('folder-Bob only').click({ button: 'right' });
    await me.getByTestId('folder-delete').click();
    await expect(me.getByTestId('folder-Bob only')).toHaveCount(0);
    await expect(list).toContainText(carolU.name);
  } finally { await closeAll(me, bob, carol); }
});
