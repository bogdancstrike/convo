import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send } from './support';

/** GRP-03: leaving a group (pending MLS removal completed by a remaining member). */
test('a member leaves a group; others see it and the leaver stops receiving; the sole owner must hand over', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [ownerU, bobU, carolU] = await Promise.all(['lowner', 'lbob', 'lcarol'].map((p) => createUser(request, p)));
  const [owner, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const groupName = `Leavers ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    for (const u of [bobU, carolU]) { await owner.getByTestId('people-search').fill(u.username); await owner.getByTestId(`pick-${u.username}`).click(); }
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'welcome all');
    await openChat(bob, groupName); await openChat(carol, groupName);
    await expect(message(bob, 'welcome all')).toBeVisible();

    bob.once('dialog', (d) => void d.accept());
    await bob.getByTestId('thread-menu').click();
    await bob.getByTestId('menu-leave').click();
    await expect(bob.getByTestId('composer')).toHaveCount(0, { timeout: 20_000 });
    await expect(owner.getByTestId('timer-notice')).toHaveText(`${bobU.name} left`, { timeout: 20_000 });
    await expect(carol.getByTestId('timer-notice')).toHaveText(`${bobU.name} left`, { timeout: 20_000 });

    // A remaining member completes the MLS removal; messages keep flowing to the others only.
    await expect(owner.getByTestId('thread-subtitle').or(owner.locator('.thread-header .sub'))).not.toContainText(bobU.name.split(' ')[0]!, { timeout: 30_000 });
    await send(owner, 'after bob left');
    await expect(message(carol, 'after bob left')).toBeVisible({ timeout: 20_000 });
    await bob.waitForTimeout(3000);
    await expect(message(bob, 'after bob left')).toHaveCount(0);

    let alertText = '';
    owner.on('dialog', (d) => { if (d.type() === 'alert') alertText = d.message(); void d.accept(); });
    await owner.getByTestId('thread-menu').click();
    await owner.getByTestId('menu-leave').click();
    await expect.poll(() => alertText).toContain('only owner');
    await expect(owner.getByTestId('composer')).toBeVisible();
  } finally { await closeAll(owner, bob, carol); }
});
