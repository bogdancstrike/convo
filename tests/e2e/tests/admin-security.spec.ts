import { expect, test, type Page } from '@playwright/test';
import { adminGo, adminSignIn, closeAll, confirmReason, createUser, enroll, newPage } from './support';

async function adminApi(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
    const token = JSON.parse(sessionStorage.getItem(key)!).access_token;
    const response = await fetch(`/v1/admin${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}
async function userId(page: Page, username: string): Promise<string> {
  const users = await adminApi(page, `/idp/users?q=${encodeURIComponent(username)}`);
  return users.body.find((p: { user: { username: string } }) => p.user.username === username).user.id;
}

test('live sessions show browser metadata, restore details with Back and end one or all real sessions', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const operator = await createUser(request, 'sessionoperator', { realmRoles: ['convo-security'] });
  const person = await createUser(request, 'sessionperson', { realmRoles: ['convo-helpdesk'] });
  const [admin, first, second] = await Promise.all([newPage(browser), newPage(browser), newPage(browser)]);
  try {
    await adminSignIn(first, person); await adminSignIn(second, person); await adminSignIn(admin, operator);
    const id = await userId(admin, person.username);
    await adminGo(admin, 'sessions');
    await admin.getByRole('combobox', { name: 'Select a person for sessions' }).fill(person.username);
    await expect(admin.getByText(`${person.username} · ${person.name}`, { exact: true })).toBeVisible();
    await admin.getByRole('combobox', { name: 'Select a person for sessions' }).press('Enter');
    const table = admin.getByTestId('sessions-table');
    await expect(table.locator('tbody tr.ant-table-row')).toHaveCount(2);
    await expect(table).toContainText(/Firefox|Chrome/);
    const row = table.locator('tbody tr.ant-table-row').first(); const sid = (await row.getAttribute('data-row-key'))!;
    // Another person's URL cannot be used to end this session.
    const mismatched = await adminApi(admin, `/idp/users/${await userId(admin, operator.username)}/sessions/${sid}/end`, 'POST', { reason: 'ownership check' });
    expect(mismatched.status).toBe(404);
    await row.getByRole('button', { name: person.username, exact: true }).click();
    await expect(admin.getByTestId('end-session')).toBeVisible();
    await admin.getByRole('button', { name: 'Maximize view', exact: true }).click();
    await expect(admin).toHaveURL(/display=page/);
    await admin.goBack(); await expect(admin.getByRole('button', { name: 'Maximize view', exact: true })).toBeVisible();
    await admin.getByTestId('end-session').click(); await confirmReason(admin, 'lost browser session');
    await expect(table.locator('tbody tr.ant-table-row')).toHaveCount(1);
    expect((await adminApi(admin, `/tables/sessions?user=${id}`)).body.total).toBe(1);
    await admin.getByTestId('end-all-sessions').click(); await confirmReason(admin, 'end remaining session');
    await expect(table.locator('tbody tr.ant-table-row')).toHaveCount(0);
    const audit = await adminApi(admin, `/tables/audit?q=lost%20browser%20session`);
    expect(audit.body.rows.some((r: { action: string }) => r.action === 'session.end')).toBe(true);
    await adminGo(admin, `users/sign-in/${id}/sessions?display=page`);
    await expect(admin.getByTestId('sessions-panel')).toBeVisible();
    await admin.screenshot({ path: 'test-results/admin-live-sessions.png', fullPage: true });
  } finally { await closeAll(admin, first, second); }
});

test('real failed logins produce one durable alert with evidence, audited lifecycle and configurable rules', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const operator = await createUser(request, 'alertoperator', { realmRoles: ['convo-security'] });
  const person = await createUser(request, 'loginfailures');
  const page = await newPage(browser);
  try {
    await adminSignIn(page, operator); await adminGo(page, 'alerts');
    for (let i = 0; i < 6; i++) {
      const result = await request.post('/auth/realms/enclave/protocol/openid-connect/token', { form: { grant_type: 'password', client_id: 'admin-cli', username: person.username, password: 'incorrect-password' } });
      expect(result.status()).toBe(401);
    }
    await expect.poll(async () => (await adminApi(page, `/tables/alerts?q=${person.username}&ruleId=failed-logins`)).body.total, { timeout: 65_000 }).toBe(1);
    const result = await adminApi(page, `/tables/alerts?q=${person.username}&ruleId=failed-logins`);
    const id = result.body.rows[0].id;
    expect(result.body.rows[0].occurrences).toBeGreaterThanOrEqual(5);
    expect(result.body.rows[0].firstSeq).toBeGreaterThan(0);
    await page.getByTestId('alerts-search').fill(person.username);
    const alertRows = page.getByTestId('alerts-table').locator('tbody tr.ant-table-row');
    await expect(alertRows).toHaveCount(1);
    await alertRows.getByRole('button', { name: 'Repeated failed logins', exact: true }).click();
    await page.getByTestId('alert-acknowledge').click(); await confirmReason(page, 'investigation started');
    await expect(page.getByTestId('alert-details')).toContainText('investigation started');
    await page.getByRole('button', { name: 'Maximize view', exact: true }).click();
    await expect(page).toHaveURL(/display=page/); await page.goBack();
    await expect(page.getByTestId('alert-details')).toBeVisible();
    await page.getByTestId('alert-resolve').click(); await confirmReason(page, 'confirmed forgotten password');
    await expect(page.getByTestId('alert-details')).toContainText('confirmed forgotten password');
    await page.getByTestId('alert-reopen').click(); await confirmReason(page, 'review once more');
    await expect(page.getByTestId('alert-details')).toContainText('review once more');
    await page.reload(); await expect(page.getByTestId('alert-details')).toContainText('review once more');
    expect((await adminApi(page, `/tables/alerts?q=${person.username}&ruleId=failed-logins`)).body.total).toBe(1);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('tab', { name: 'Detection rules' }).click();
    const rule = page.getByTestId('alert-rule-failed-logins');
    await rule.getByLabel('Reason for this change').fill('verify rule editing');
    await rule.getByRole('button', { name: 'Save rule' }).click();
    await expect(page.getByText('Alert rule updated', { exact: true })).toBeVisible();
    const invalid = await adminApi(page, '/alerts/rules/failed-logins', 'POST', { enabled: true, severity: 'high', threshold: 0, windowMinutes: 5, notificationsEnabled: true, reason: 'invalid rule' });
    expect(invalid.status).toBe(400);
    const audit = await adminApi(page, '/tables/audit?q=investigation%20started');
    expect(audit.body.rows.some((r: { action: string }) => r.action === 'alert.acknowledge')).toBe(true);
    const detail = await adminApi(page, `/alerts/${id}`); expect(detail.body.history.length).toBeGreaterThanOrEqual(4);
    await page.screenshot({ path: 'test-results/admin-alert-rules.png', fullPage: true });
  } finally { await closeAll(page); }
});

test('device enrollment and role grants trigger alerts while helpdesk and auditors retain separate duties', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const rootUser = await createUser(request, 'alertrulesadmin', { realmRoles: ['convo-admin'] });
  const helperUser = await createUser(request, 'sessionhelper', { realmRoles: ['convo-helpdesk'] });
  const auditorUser = await createUser(request, 'alertauditor', { realmRoles: ['convo-auditor'] });
  const personUser = await createUser(request, 'alertdevice');
  const [root, helper, auditor, person] = await Promise.all([newPage(browser), newPage(browser), newPage(browser), newPage(browser)]);
  let saved: Record<string, unknown> | null = null;
  try {
    await root.addInitScript(() => {
      const state = window as unknown as { receivedSecurityNotifications: string[] };
      state.receivedSecurityNotifications = [];
      class TestNotification {
        static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); }
        onclick = null; close() {}
        constructor(title: string) { state.receivedSecurityNotifications.push(title); }
      }
      Object.defineProperty(window, 'Notification', { value: TestNotification, configurable: true });
    });
    await adminSignIn(root, rootUser); await adminGo(root, 'alerts');
    await root.getByRole('switch', { name: 'Desktop security notifications' }).click();
    const rules = await adminApi(root, '/alerts/rules'); saved = rules.body.find((r: { id: string }) => r.id === 'device-burst');
    expect((await adminApi(root, '/alerts/rules/device-burst', 'POST', { ...saved, threshold: 1, reason: 'exercise real device signal' })).status).toBe(200);
    await enroll(person, personUser);
    const subject = await userId(root, helperUser.username);
    expect((await adminApi(root, `/idp/users/${subject}/roles`, 'POST', { role: 'convo-org-admin', granted: true, reason: 'exercise role grant detection' })).status).toBe(200);
    await expect.poll(async () => (await adminApi(root, `/tables/alerts?q=${personUser.username}&ruleId=device-burst`)).body.total, { timeout: 65_000 }).toBe(1);
    await expect.poll(async () => (await adminApi(root, `/tables/alerts?q=${helperUser.username}&ruleId=role-grant`)).body.total, { timeout: 65_000 }).toBe(1);
    await root.getByTestId('alerts-refresh').click();
    await expect.poll(() => root.evaluate(() => (window as unknown as { receivedSecurityNotifications: string[] }).receivedSecurityNotifications.some((title) => title.includes('Privileged role granted')))).toBe(true);
    const notifications = await root.evaluate(() => (window as unknown as { receivedSecurityNotifications: string[] }).receivedSecurityNotifications.length);
    await root.getByTestId('alerts-refresh').click();
    await expect.poll(() => root.evaluate(() => (window as unknown as { receivedSecurityNotifications: string[] }).receivedSecurityNotifications.length)).toBe(notifications);
    await adminSignIn(helper, helperUser); await adminSignIn(auditor, auditorUser);
    expect((await adminApi(helper, '/alerts/summary')).status).toBe(403);
    expect((await adminApi(auditor, '/alerts/summary')).status).toBe(200);
    expect((await adminApi(auditor, `/tables/sessions?user=${subject}`)).status).toBe(403);
    const alert = (await adminApi(auditor, `/tables/alerts?q=${helperUser.username}&ruleId=role-grant`)).body.rows[0];
    expect((await adminApi(auditor, `/alerts/${alert.id}/status`, 'POST', { status: 'resolved', reason: 'not authorized' })).status).toBe(403);
    expect((await adminApi(auditor, '/alerts/rules/device-burst', 'POST', { ...saved, reason: 'not authorized' })).status).toBe(403);
    await adminGo(auditor, `alerts/${alert.id}`);
    await expect(auditor.getByTestId('alert-details')).toContainText('Privileged role granted');
    await expect(auditor.getByTestId('alert-resolve')).toHaveCount(0);
    await auditor.getByRole('button', { name: 'Close', exact: true }).click();
    await auditor.getByRole('tab', { name: 'Detection rules' }).click();
    await expect(auditor.getByRole('button', { name: 'Save rule' })).toHaveCount(0);
  } finally {
    if (saved) await adminApi(root, '/alerts/rules/device-burst', 'POST', { ...saved, reason: 'restore rule after verification' });
    await closeAll(root, helper, auditor, person);
  }
});
