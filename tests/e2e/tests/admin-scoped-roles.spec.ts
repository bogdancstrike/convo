import { expect, test } from '@playwright/test';
import { adminSignIn, closeAll, createUser, newPage } from './support';

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
