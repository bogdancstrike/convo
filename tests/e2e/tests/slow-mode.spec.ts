import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, send } from './support';

/** Specs §30.4: slow mode and per-member send restrictions, set by owners/admins. */
test('slow mode spaces member posts; a restricted member can read but not send', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [ownerU, bobU] = await Promise.all(['slowowner', 'slowbob'].map((p) => createUser(request, p)));
  const [owner, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(owner, ownerU); await enroll(bob, bobU);
    const groupName = `Slow group ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    await owner.getByTestId('people-search').fill(bobU.username); await owner.getByTestId(`pick-${bobU.username}`).click();
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'welcome');

    await owner.getByTestId('thread-info').click();
    await owner.getByTestId('slow-mode-select').selectOption('30');
    await openChat(bob, groupName);
    await expect(bob.getByTestId('slow-mode-note')).toBeVisible({ timeout: 20_000 });
    await send(bob, 'first from bob');
    await expect(owner.getByTestId('message-body').filter({ hasText: 'first from bob' })).toBeVisible({ timeout: 20_000 });
    await send(bob, 'too soon');
    await expect(bob.getByRole('alert').filter({ hasText: /Slow mode/ })).toBeVisible();
    await expect(bob.getByTestId('composer')).toHaveValue('too soon'); // text is given back
    // Owners and admins are not limited.
    await send(owner, 'owner one'); await send(owner, 'owner two');
    await expect(bob.getByTestId('message-body').filter({ hasText: 'owner two' })).toBeVisible({ timeout: 20_000 });

    await owner.getByTestId(`member-menu-${bobU.username}`).click();
    await owner.getByTestId('member-restrict').click();
    await expect(owner.getByTestId(`restricted-${bobU.username}`)).toBeVisible();
    await expect(bob.getByTestId('restricted-banner')).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByTestId('composer')).toHaveCount(0);

    await owner.getByTestId(`member-menu-${bobU.username}`).click();
    await owner.getByTestId('member-restrict').click();
    await expect(bob.getByTestId('composer')).toBeVisible({ timeout: 20_000 });
  } finally { await closeAll(owner, bob); }
});
