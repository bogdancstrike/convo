import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat } from './support';

/** @mentions in groups (FEAT-02): suggestions, structured mention, highlight and @ badge. */
test('mention a group member from suggestions; only they get the @ badge', async ({ browser, request }) => {
  const [ownerU, bobU, carolU] = await Promise.all(['mowner', 'mbob', 'mcarol'].map((p) => createUser(request, p)));
  const [owner, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const groupName = `Mentions ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click();
    await owner.getByTestId('new-group').click();
    for (const u of [bobU, carolU]) {
      await owner.getByTestId('people-search').fill(u.username);
      await owner.getByTestId(`pick-${u.username}`).click();
    }
    await owner.getByTestId('group-next').click();
    await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click();
    await owner.getByTestId('create-group').click();
    await expect(owner.getByTestId('thread-title')).toHaveText(groupName);
    // Members see the group (Welcome processed) before the mention arrives.
    await expect(bob.locator('.chat-row').filter({ hasText: groupName })).toBeVisible({ timeout: 30_000 });
    await expect(carol.locator('.chat-row').filter({ hasText: groupName })).toBeVisible({ timeout: 30_000 });

    const composer = owner.getByTestId('composer');
    await composer.pressSequentially(`please review @${bobU.name.slice(0, 3)}`);
    await expect(owner.getByTestId('mention-suggestions')).toBeVisible();
    await owner.keyboard.press('Enter'); // picks the highlighted suggestion
    await expect(composer).toHaveValue(`please review @${bobU.name} `);
    await composer.pressSequentially('today');
    await composer.press('Enter');
    const text = `please review @${bobU.name} today`;
    await expect(message(owner, text).getByTestId('mention')).toHaveText(`@${bobU.name}`);

    const bobRow = bob.locator('.chat-row').filter({ hasText: groupName });
    await expect(bobRow.getByTestId('mention-badge')).toBeVisible({ timeout: 20_000 });
    const carolRow = carol.locator('.chat-row').filter({ hasText: groupName });
    await expect(carolRow.locator('.badge')).toBeVisible({ timeout: 20_000 });
    await expect(carolRow.getByTestId('mention-badge')).toHaveCount(0);

    await openChat(bob, groupName);
    await expect(message(bob, text).getByTestId('mention')).toHaveText(`@${bobU.name}`);
    await bob.getByTestId('nav-chats').click();
    await expect(bobRow.getByTestId('mention-badge')).toHaveCount(0);
  } finally { await closeAll(owner, bob, carol); }
});
