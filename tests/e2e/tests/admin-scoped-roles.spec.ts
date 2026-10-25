import { expect, test } from '@playwright/test';
import { adminSignIn, closeAll, createUser, enroll, newPage } from './support';

/** AC-ADM-01: platform operators see infrastructure only; compliance officers see audit and policy. */
test('platform and compliance roles get only their pages', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [platformU, complianceU] = await Promise.all([
    createUser(request, 'platop', { realmRoles: ['convo-platform'] }), createUser(request, 'complo', { realmRoles: ['convo-compliance'] })]);
  const [platform, compliance] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    await adminSignIn(platform, platformU);
    await expect(platform.getByTestId('admin-tab-health')).toBeVisible();
    for (const tab of ['users', 'sessions', 'alerts', 'audit', 'policy', 'overview']) await expect(platform.getByTestId(`admin-tab-${tab}`)).toHaveCount(0);

    await adminSignIn(compliance, complianceU);
    for (const tab of ['audit', 'policy', 'overview']) await expect(compliance.getByTestId(`admin-tab-${tab}`)).toBeVisible();
    for (const tab of ['users', 'sessions', 'alerts', 'health']) await expect(compliance.getByTestId(`admin-tab-${tab}`)).toHaveCount(0);
    await compliance.getByTestId('admin-tab-policy').click();
    await expect(compliance.getByText('Your admin role can view the policy but not change it.')).toBeVisible();
  } finally { await closeAll(platform, compliance); }
});

/** ADM-01 aggregate health: counts only, readable by the platform operator. */
test('service metrics show aggregate delivery and group health', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const platformU = await createUser(request, 'platmetrics', { realmRoles: ['convo-platform'] });
  const page = await newPage(browser);
  try {
    await adminSignIn(page, platformU);
    await page.getByTestId('admin-tab-health').click();
    await page.getByRole('tab', { name: 'Service metrics' }).click();
    const metrics = page.getByTestId('admin-service-metrics');
    await expect(metrics).toBeVisible();
    for (const id of ['metric-waiting', 'metric-groups', 'metric-enrolled', 'metric-blocked-groups', 'metric-push-pending']) {
      await expect(metrics.getByTestId(id).locator('.ant-statistic-content-value')).toHaveText(/^[\d,]+$/, { timeout: 20_000 });
    }
    await expect(metrics).toContainText('No people, devices or conversations are identified here');
  } finally { await closeAll(page); }
});

/** The apps keep no IdP session after enrollment: Sessions lists the person's Convo devices too. */
test('sessions page lists the person\'s Convo devices next to sign-in sessions', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const [helpU, personU] = await Promise.all([createUser(request, 'sesshelp', { realmRoles: ['convo-helpdesk'] }), createUser(request, 'sessperson')]);
  const [admin, person] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    await enroll(person, personU);
    await adminSignIn(admin, helpU);
    await admin.getByTestId('admin-tab-sessions').click();
    const picker = admin.getByRole('combobox', { name: 'Select a person for sessions' });
    await picker.fill(personU.username);
    await expect(admin.locator('.ant-select-item-option').filter({ hasText: personU.username }).first()).toBeVisible({ timeout: 15_000 });
    await picker.press('Enter');
    const card = admin.getByTestId('convo-devices');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Web app');
    await expect(card).toContainText('keep no sign-in session');
  } finally { await closeAll(admin, person); }
});
