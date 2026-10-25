import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, send } from './support';

/** Specs §30.4: topics inside a group, admin-managed, closeable, messages filtered by topic. */
test('group topics: admin creates and closes a topic; members post in it and see it separately', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [ownerU, bobU] = await Promise.all(['topowner', 'topbob'].map((p) => createUser(request, p)));
  const [owner, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(owner, ownerU); await enroll(bob, bobU);
    const groupName = `Topic group ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    await owner.getByTestId('people-search').fill(bobU.username); await owner.getByTestId(`pick-${bobU.username}`).click();
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'general chatter');

    await owner.getByTestId('topic-add').click();
    await owner.getByTestId('topic-name').fill('Launch');
    await owner.getByTestId('topic-save').click();
    await expect(owner.getByTestId('topic-Launch')).toHaveAttribute('aria-pressed', 'true');
    await send(owner, 'launch is on Friday');

    await openChat(bob, groupName);
    await expect(bob.getByTestId('topic-Launch')).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByTestId('topic-add')).toHaveCount(0); // members don't manage topics
    // General shows only general messages.
    await expect(bob.getByTestId('message-body').filter({ hasText: 'general chatter' })).toBeVisible();
    await expect(bob.getByTestId('message-body').filter({ hasText: 'launch is on Friday' })).toHaveCount(0);
    await bob.getByTestId('topic-Launch').click();
    await expect(bob.getByTestId('message-body').filter({ hasText: 'launch is on Friday' })).toBeVisible();
    await expect(bob.getByTestId('message-body').filter({ hasText: 'general chatter' })).toHaveCount(0);
    await send(bob, 'I will bring the slides');
    await expect(owner.getByTestId('message-body').filter({ hasText: 'I will bring the slides' })).toBeVisible({ timeout: 20_000 });

    // Closing makes the topic read-only for members.
    await owner.getByTestId('topic-Launch').click({ button: 'right' });
    await owner.getByTestId('topic-toggle-closed').click();
    await expect(bob.getByTestId('topic-closed')).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByTestId('composer')).toHaveCount(0);
    await bob.getByTestId('topic-general').click();
    await expect(bob.getByTestId('composer')).toBeVisible();
  } finally { await closeAll(owner, bob); }
});
