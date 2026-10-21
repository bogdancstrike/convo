import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { closeAll, createUser, enroll, newPage } from './support';

async function adminSignIn(page: Page, user: { username: string; password: string }) {
  await page.goto('/admin');
  await page.getByTestId('admin-sign-in').click();
  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.locator('#kc-login').click();
  await expect(page.getByTestId('admin-name')).toBeVisible({ timeout: 30_000 });
}

/** AC-ADM-01/03: scoped admin roles see only their duties; audit exports are accountable. */
test('helpdesk and auditor roles see only their own duties; exports are audited', async ({ browser, request }) => {
  const helpdeskU = await createUser(request, 'helpdesk', { realmRoles: ['convo-helpdesk'] });
  const auditorU = await createUser(request, 'auditor', { realmRoles: ['convo-auditor'] });
  const memberU = await createUser(request, 'supported');
  const [helpdesk, auditor, member] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    await enroll(member, memberU);

    // Helpdesk: accounts and devices, can revoke a device, cannot disable accounts or read the audit log.
    await adminSignIn(helpdesk, helpdeskU);
    await expect(helpdesk.getByTestId('admin-roles')).toHaveText('convo-helpdesk');
    await expect(helpdesk.getByTestId('admin-tab-audit')).toHaveCount(0);
    await helpdesk.getByTestId('admin-search').fill(memberU.username);
    const row = helpdesk.getByTestId(`admin-account-${memberU.username}`);
    await expect(row.getByTestId('admin-status')).toHaveText('active', { timeout: 20_000 });
    await expect(row.getByTestId('admin-toggle-status')).toHaveCount(0);
    await row.getByTestId('admin-devices').click();
    await expect(helpdesk.getByTestId('admin-device-list').getByTestId('admin-revoke')).toHaveCount(1);
    // Aggregate health is readable (counts only); re-queueing failed wake-ups is a security duty.
    await helpdesk.getByTestId('admin-tab-health').click();
    await expect(helpdesk.getByTestId('admin-push-pending')).toHaveText(/^\d+$/);
    await expect(helpdesk.getByTestId('admin-push-redrive')).toHaveCount(0);

    // Auditor: only the audit log; verify and export (the export is recorded with its reason).
    await adminSignIn(auditor, auditorU);
    await expect(auditor.getByTestId('admin-tab-accounts')).toHaveCount(0);
    await expect(auditor.getByTestId('admin-search')).toHaveCount(0);
    await expect(auditor.getByTestId('admin-tab-health')).toHaveCount(0);
    await auditor.getByTestId('admin-verify').click();
    await expect(auditor.getByTestId('admin-verification')).toContainText('Chain intact');
    const reason = `quarterly review ${Date.now()}`;
    auditor.once('dialog', (d) => void d.accept(reason));
    const [download] = await Promise.all([auditor.waitForEvent('download'), auditor.getByTestId('admin-export').click()]);
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(exported.verification.valid).toBe(true);
    expect(exported.entries.some((e: { action: string; reason: string }) => e.action === 'audit.export' && e.reason === reason)).toBe(true);
    await expect(auditor.getByTestId('admin-audit-entry').filter({ hasText: reason })).toContainText('audit.export');
  } finally { await closeAll(helpdesk, auditor, member); }
});
