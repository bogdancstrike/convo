import { expect, test, type Page } from '@playwright/test';
import { ADMIN_URL, adminSignIn, closeAll, confirmReason, createUser, enroll, newPage, send, adminGo } from './support';

/**
 * ADM-01 user management on the admin console: create sign-in accounts with a one-time temporary
 * password, reset passwords, block sign-in, revoke a lost recovery kit, grant admin roles, and
 * read activity statistics. Every change is audited; nobody can change their own sign-in.
 */
async function openSignIn(admin: Page, username: string) {
  await admin.getByTestId('admin-tab-users').click();
  await admin.getByTestId('admin-search').fill(username);
  await admin.getByTestId(`idp-user-${username}`).getByRole('button').first().click();
  return admin.getByTestId('user-drawer');
}

async function messengerSignIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Sign in with your organization' }).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
}

test('create a user, temporary password, reset, block and allow sign-in', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const adminU = await createUser(request, 'superadmin', { realmRoles: ['convo-admin'] });
  const [admin, person] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    await adminSignIn(admin, adminU);
    const username = `new-${Date.now() % 100000}`;
    await admin.getByTestId('admin-tab-users').click();
    await admin.getByTestId('admin-create-user').click();
    await admin.getByTestId('create-username').fill(username);
    await admin.getByTestId('create-first').fill('Newly');
    await admin.getByTestId('create-last').fill('Hired');
    await admin.getByTestId('create-phone').fill(`+40 7${String(Date.now()).slice(-8)}`);
    await admin.getByTestId('create-reason').fill('new starter');
    await admin.getByTestId('create-user-submit').click();
    const temporary = (await admin.getByTestId('one-time-secret').innerText()).trim();
    expect(temporary.length).toBeGreaterThanOrEqual(20);
    await admin.getByRole('button', { name: 'OK' }).click();
    const drawer = admin.getByTestId('user-drawer');
    await expect(drawer.getByTestId('signin-required')).toContainText('Change password');

    // The new person signs in with the temporary password and must choose their own.
    await messengerSignIn(person, username, temporary);
    await expect(person.locator('#password-new')).toBeVisible({ timeout: 20_000 });
    const own = `own-${Date.now()}`;
    await person.locator('#password-new').fill(own);
    await person.locator('#password-confirm').fill(own);
    await person.locator('input[type="submit"], button[type="submit"]').first().click();
    await expect(person.getByTestId('nav-settings').or(person.getByText(/set up|enroll|Convo/i).first())).toBeVisible({ timeout: 45_000 });

    // Reset gives a new one-time password; the audit records the reason, never the password.
    await admin.goto(`${ADMIN_URL}/#/sign-in`);
    const again = await openSignIn(admin, username);
    await again.getByRole('tab', { name: 'Security' }).click();
    await again.getByTestId('signin-reset-password').click();
    await confirmReason(admin, 'forgot password');
    const reset = (await admin.getByTestId('one-time-secret').innerText()).trim();
    expect(reset).not.toBe(temporary);
    await admin.getByRole('button', { name: 'OK' }).click();

    // Blocking sign-in refuses the password at the sign-in page; allowing restores it.
    await again.getByTestId('signin-block').click();
    await confirmReason(admin, 'left the company');
    await expect(admin.locator('.ant-drawer-title')).toContainText('Sign-in blocked');
    const blocked = await newPage(browser);
    await messengerSignIn(blocked, username, reset);
    await expect(blocked.locator('#input-error, .kc-feedback-text, [class*="alert"]').first()).toBeVisible({ timeout: 20_000 });
    await again.getByTestId('signin-allow').click();
    await confirmReason(admin, 'returned');
    await expect(admin.locator('.ant-drawer-title')).toContainText('Sign-in allowed');
    await again.getByRole('tab', { name: /Audit/ }).click();
    await expect(again.getByTestId('signin-audit')).toContainText('user.sign-in-block');
    await closeAll(blocked);

    await adminGo(admin, 'audit');
    for (const action of ['user.create', 'user.password-reset', 'user.sign-in-block', 'user.sign-in-allow']) {
      await expect(admin.getByTestId('admin-audit-entry').filter({ hasText: action }).first()).toBeVisible();
    }
    await expect(admin.getByTestId('admin-audit-entry').filter({ hasText: reset })).toHaveCount(0);
  } finally { await closeAll(admin, person); }
});

test('revoke a lost recovery kit; roles need the superuser; no admin changes their own sign-in', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const superU = await createUser(request, 'rootadmin', { realmRoles: ['convo-admin'] });
  const securityU = await createUser(request, 'secops', { realmRoles: ['convo-security'] });
  const memberU = await createUser(request, 'kitowner');
  const helperU = await createUser(request, 'futurehelp');
  const [root, security, member] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    await enroll(member, memberU);
    await member.getByTestId('new-chat').click(); await member.getByTestId('note-to-self').click(); await send(member, 'activity for the dashboard');
    await member.getByTestId('nav-settings').click();
    await member.getByTestId('settings-recovery').click();
    await member.getByTestId('create-recovery-code').click();
    await expect(member.getByTestId('recovery-code')).toBeVisible();
    await member.reload({ waitUntil: 'domcontentloaded' });
    await member.getByTestId('nav-settings').click({ timeout: 45_000 });
    await member.getByTestId('settings-recovery').click();
    await expect(member.getByTestId('recovery-state')).toHaveAttribute('data-configured', 'true');

    // Security operator revokes the kit (reason + recent sign-in); the app asks for a new one.
    await adminSignIn(security, securityU);
    await security.getByTestId('admin-tab-users').click();
    await security.getByTestId('admin-search').fill(memberU.username);
    await security.getByTestId(`admin-account-${memberU.username}`).getByRole('button', { name: memberU.name, exact: true }).click();
    const drawer = security.getByTestId('user-drawer');
    await drawer.getByRole('tab', { name: 'Security' }).click();
    await drawer.getByTestId('admin-revoke-recovery').click();
    await confirmReason(security, 'kit photo was shared');
    await expect(security.getByText('Recovery kit revoked')).toBeVisible();
    await member.reload({ waitUntil: 'domcontentloaded' });
    await member.getByTestId('nav-settings').click({ timeout: 45_000 });
    await member.getByTestId('settings-recovery').click();
    await expect(member.getByTestId('recovery-state')).toHaveAttribute('data-configured', 'false');

    // The activity statistics count the member's encrypted items (counts only).
    await adminGo(security, 'overview');
    await expect(security.getByTestId('kpi-items')).toBeVisible();
    await security.getByTestId('admin-tab-overview').click();
    await security.getByTestId('activity-search').locator('input').fill(memberU.username);
    await security.locator('.ant-select-item-option').filter({ hasText: memberU.username }).click();
    const activity = security.getByTestId('person-activity');
    await expect(activity).toContainText('Days used');
    await expect(activity).toContainText(memberU.username);
    await expect(security.getByTestId('kpi-accounts')).toHaveCount(0);
    await adminGo(security, 'activity');

    // Security cannot grant roles; the superuser can, but not to themselves.
    let signIn = await (async () => { await security.getByTestId('admin-tab-users').click(); await security.getByTestId('admin-search').fill(helperU.username);
      await security.getByTestId(`idp-user-${helperU.username}`).getByRole('button').first().click(); return security.getByTestId('user-drawer'); })();
    await signIn.getByRole('tab', { name: 'Roles' }).click();
    await expect(signIn.getByTestId('role-convo-helpdesk')).toHaveCount(0);
    await adminSignIn(root, superU);
    signIn = await openSignIn(root, helperU.username);
    await signIn.getByRole('tab', { name: 'Roles' }).click();
    await signIn.getByTestId('role-convo-helpdesk').click();
    await confirmReason(root, 'joins the helpdesk');
    await expect(signIn.getByText('Helpdesk').first()).toBeVisible();
    // The roles page lists the new holder and draws the permission map.
    await adminGo(root, 'roles');
    await root.getByRole('button', { name: /Helpdesk.*permissions/ }).click();
    await root.getByPlaceholder('Search name or username').fill(helperU.username);
    await expect(root.getByTestId('role-card-convo-helpdesk')).toContainText(helperU.username);
    await root.getByRole('tab', { name: 'Permission map' }).click();
    await expect(root.getByTestId('permission-map').locator('.react-flow__node')).not.toHaveCount(0);
    await adminGo(root, 'sign-in');
    const own = await openSignIn(root, superU.username);
    await own.getByRole('tab', { name: 'Security' }).click();
    await own.getByTestId('signin-reset-password').click();
    await confirmReason(root, 'self');
    await expect(root.getByText(/another administrator/i)).toBeVisible();
  } finally { await closeAll(root, security, member); }
});
