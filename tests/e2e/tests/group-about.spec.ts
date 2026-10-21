import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, send } from './support';

/** Specs §30.8 rich descriptions: owners/admins edit an E2EE About text; members read it safely. */
test('owners edit the group name and About; members read the formatted description', async ({ browser, request }) => {
  const [ownerU, bobU] = await Promise.all(['abowner', 'abbob'].map((p) => createUser(request, p)));
  const [owner, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(owner, ownerU); await enroll(bob, bobU);
    const groupName = `Ops ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    await owner.getByTestId('people-search').fill(bobU.username); await owner.getByTestId(`pick-${bobU.username}`).click();
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'kick-off');

    await owner.getByTestId('thread-info').click();
    await owner.getByTestId('edit-group-info').click();
    await owner.getByTestId('group-name-edit').fill(`${groupName} team`);
    await owner.getByTestId('group-description-edit').fill('Weekly *operations* sync.\nAgenda: https://example.org/agenda <script>x</script>');
    await owner.getByTestId('save-group-info').click();
    await expect(owner.getByTestId('group-description')).toContainText('Weekly operations sync.');

    await expect(async () => {
      await openChat(bob, `${groupName} team`);
    }).toPass({ timeout: 30_000 });
    await bob.getByTestId('thread-info').click();
    const about = bob.getByTestId('group-description');
    await expect(about.locator('strong')).toHaveText('operations', { timeout: 20_000 });
    await expect(about.locator('a')).toHaveText('https://example.org/agenda');
    await expect(about).toContainText('<script>x</script>'); // shown as text, never executed
    await expect(bob.locator('script', { hasText: 'x' })).toHaveCount(0);
    await expect(bob.getByTestId('edit-group-info')).toHaveCount(0); // members cannot edit
  } finally { await closeAll(owner, bob); }
});
