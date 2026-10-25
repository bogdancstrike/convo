import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { closeAll, createUser, enroll, newPage, openChat, send } from './support';

/** FR-EXT-01 events: RSVP, creator edits (revisions), cancellation closes responses, calendar export. */
test('group event: RSVP and change answer, creator edits and cancels, members cannot edit', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [ownerU, bobU] = await Promise.all(['evowner', 'evbob'].map((p) => createUser(request, p)));
  const [owner, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(owner, ownerU); await enroll(bob, bobU);
    const groupName = `Event group ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click(); await owner.getByTestId('new-group').click();
    await owner.getByTestId('people-search').fill(bobU.username); await owner.getByTestId(`pick-${bobU.username}`).click();
    await owner.getByTestId('group-next').click(); await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click(); await owner.getByTestId('create-group').click();
    await send(owner, 'save the date');
    await openChat(bob, groupName);

    await owner.getByTestId('attach-button').click(); await owner.getByTestId('attach-event').click();
    await owner.getByTestId('event-name').fill('Team dinner');
    await owner.getByTestId('event-location').fill('Old Town, Bucharest');
    await owner.getByTestId('event-save').click();
    const card = (page: typeof owner) => page.getByTestId('event-card').filter({ hasText: 'Team dinner' });
    await expect(card(bob)).toBeVisible({ timeout: 20_000 });
    await expect(card(bob)).toContainText('Old Town, Bucharest');
    await expect(card(bob).getByTestId('event-edit')).toHaveCount(0);

    await card(bob).getByTestId('rsvp-going').click();
    await expect(card(owner).getByTestId('rsvp-count-going')).toHaveText('1', { timeout: 20_000 });
    await card(bob).getByTestId('rsvp-maybe').click();
    await expect(card(owner).getByTestId('rsvp-count-maybe')).toHaveText('1', { timeout: 20_000 });
    await expect(card(owner).getByTestId('rsvp-count-going')).toHaveText('0');
    await card(owner).getByTestId('event-responses').click();
    await expect(card(owner)).toContainText(bobU.name.split(' ')[0]!);

    // Calendar export is a standard iCalendar file.
    const [download] = await Promise.all([owner.waitForEvent('download'), card(owner).getByTestId('event-ics').click()]);
    const ics = await readFile((await download.path())!, 'utf8');
    expect(ics).toContain('SUMMARY:Team dinner');

    // The creator edits: a new revision reaches the member.
    await card(owner).getByTestId('event-edit').click();
    await owner.getByTestId('event-name').fill('Team dinner (moved)');
    await owner.getByTestId('event-save').click();
    await expect(bob.getByTestId('event-card')).toContainText('Team dinner (moved)', { timeout: 20_000 });
    await expect(bob.getByTestId('event-card')).toHaveAttribute('data-revision', '1');

    // Cancelling closes responses everywhere.
    await owner.getByTestId('event-card').getByTestId('event-cancel').click();
    await expect(bob.getByTestId('event-card')).toHaveAttribute('data-cancelled', 'true', { timeout: 20_000 });
    await expect(bob.getByTestId('event-card').getByTestId('rsvp-going')).toBeDisabled();
    await expect(bob.getByTestId('event-card').getByTestId('event-status')).toHaveText('This event was cancelled');
    await owner.screenshot({ path: test.info().outputPath('events.png') });
  } finally { await closeAll(owner, bob); }
});
