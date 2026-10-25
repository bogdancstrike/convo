import { expect, test } from '@playwright/test';
import { adminSignIn, closeAll, confirmReason, createUser, enroll, newPage, openChat, send } from './support';

/**
 * AC-INT-01 (slice): an organization admin marks a dedicated account as an archive; people see the
 * label, are asked before adding it to a group, and every member sees a banner with its retention.
 */
test('archive accounts are visible: label, confirmation before adding, banner for every member', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const [adminU, ownerU, memberU, archiveU] = await Promise.all([
    createUser(request, 'intadmin', { realmRoles: ['convo-org-admin'] }), createUser(request, 'intowner'), createUser(request, 'intmember'), createUser(request, 'intarchive')]);
  const [admin, owner, member, archive] = await Promise.all([1, 2, 3, 4].map(() => newPage(browser)));
  try {
    await Promise.all([enroll(owner, ownerU), enroll(member, memberU), enroll(archive, archiveU)]);
    const retention = 'Kept for 7 years for regulatory archiving.';

    await adminSignIn(admin, adminU);
    await admin.getByTestId('admin-tab-users').click();
    await admin.getByTestId('admin-search').fill(archiveU.username);
    await admin.getByTestId(`admin-account-${archiveU.username}`).getByRole('button', { name: archiveU.name, exact: true }).click();
    await admin.getByTestId('user-drawer').getByRole('tab', { name: 'Security' }).click();
    await admin.getByTestId('integration-kind').click();
    await admin.getByTitle('Archive (keeps what it receives)').click();
    await admin.getByTestId('integration-retention').fill(retention);
    await admin.getByTestId('integration-save').click();
    await confirmReason(admin, 'records archive for compliance');
    await expect(admin.getByTestId('integration-section')).toContainText('Marked as archive', { timeout: 15_000 });

    // The owner is asked before the archive joins; the label shows in the picker.
    const asked: string[] = [];
    owner.on('dialog', (d) => { asked.push(d.message()); void d.accept(); });
    const groupName = `Archived ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click();
    await owner.getByTestId('new-group').click();
    for (const u of [memberU, archiveU]) {
      await owner.getByTestId('people-search').fill(u.username);
      await owner.getByTestId(`pick-${u.username}`).click();
    }
    await expect(owner.getByTestId(`pick-${archiveU.username}`).getByTestId('integration-badge')).toHaveText('Archive');
    expect(asked.join(' ')).toContain('will receive every message in this group');
    await owner.getByTestId('group-next').click();
    await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click();
    await owner.getByTestId('create-group').click();
    await send(owner, 'first message');

    for (const page of [owner, member]) {
      if (page === member) await openChat(member, groupName);
      const banner = page.getByTestId('integration-banner');
      await expect(banner).toContainText(`${archiveU.name} (Archive) receives every message in this chat.`, { timeout: 30_000 });
      await expect(banner).toContainText(retention);
    }
  } finally { await closeAll(admin, owner, member, archive); }
});
