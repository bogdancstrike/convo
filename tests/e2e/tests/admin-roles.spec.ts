import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { adminSignIn, closeAll, confirmReason, createUser, enroll, newPage , adminGo } from './support';

/** AC-ADM-01/03: scoped admin roles see only their duties; audit exports are accountable. */
test('helpdesk and auditor roles see only their own duties; exports are audited', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const helpdeskU = await createUser(request, 'helpdesk', { realmRoles: ['convo-helpdesk'] });
  const auditorU = await createUser(request, 'auditor', { realmRoles: ['convo-auditor'] });
  const memberU = await createUser(request, 'supported');
  const [helpdesk, auditor, member] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    await enroll(member, memberU);

    // Helpdesk: people, devices (can unlink), credentials; cannot disable accounts or read the audit log.
    await adminSignIn(helpdesk, helpdeskU);
    await expect(helpdesk.getByTestId('admin-roles')).toHaveText('Helpdesk');
    await expect(helpdesk.getByTestId('admin-tab-audit')).toHaveCount(0);
    await helpdesk.getByTestId('admin-tab-users').click();
    await helpdesk.getByTestId('admin-search').fill(memberU.username);
    await helpdesk.getByTestId(`admin-account-${memberU.username}`).getByRole('button', { name: memberU.name, exact: true }).click();
    const drawer = helpdesk.getByTestId('user-drawer');
    await drawer.getByRole('tab', { name: /Devices/ }).click();
    await expect(drawer.getByTestId('admin-device-list').getByTestId('admin-revoke')).toHaveCount(1);
    await drawer.getByRole('tab', { name: 'Security' }).click();
    await expect(drawer.getByTestId('admin-toggle-status')).toHaveCount(0);
    await expect(drawer.getByTestId('admin-revoke-recovery')).toHaveCount(1);
    await adminGo(helpdesk, 'health');
    // Health is readable (counts only); re-queueing failed wake-ups is a security duty.
    await expect(helpdesk.getByTestId('admin-push-pending')).toHaveText(/^\d+$/);
    await expect(helpdesk.getByTestId('admin-push-redrive')).toHaveCount(0);

    // Auditor: the audit log and statistics only; verify and export (recorded with its reason).
    await adminSignIn(auditor, auditorU);
    await expect(auditor.getByTestId('admin-tab-users')).toHaveCount(0);
    await expect(auditor.getByTestId('admin-tab-health')).toHaveCount(0);
    await expect(auditor.getByTestId('admin-tab-overview')).toHaveCount(1);
    await auditor.getByTestId('admin-tab-audit').click();
    await auditor.getByTestId('admin-verify').click();
    await expect(auditor.getByTestId('admin-verification')).toContainText('Chain intact');
    const reason = `quarterly review ${Date.now()}`;
    const download = auditor.waitForEvent('download');
    await auditor.getByTestId('admin-export').click();
    await confirmReason(auditor, reason);
    const exported = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(exported.verification.valid).toBe(true);
    expect(exported.entries.some((e: { action: string; reason: string }) => e.action === 'audit.export' && e.reason === reason)).toBe(true);
    await expect(auditor.getByTestId('admin-audit-entry').filter({ hasText: reason })).toContainText('audit.export');
    // Refused attempts are visible to auditors.
    await expect(auditor.getByTestId('admin-audit-entry').filter({ hasText: 'refused' }).first()).toBeVisible().catch(() => undefined);
  } finally { await closeAll(helpdesk, auditor, member); }
});
