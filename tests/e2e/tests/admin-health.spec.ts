import { expect, test, type Page } from '@playwright/test';
import { adminGo, adminSignIn, closeAll, createUser, newPage } from './support';

async function systemHealth(page: Page) {
  return page.evaluate(async () => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
    const token = JSON.parse(sessionStorage.getItem(key)!).access_token;
    const response = await fetch('/v1/admin/health/system', { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  });
}

test('helpdesk can inspect real component checks, search and restore details with Back', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const user = await createUser(request, 'healthoperator', { realmRoles: ['convo-helpdesk'] });
  const page = await newPage(browser);
  try {
    await adminSignIn(page, user);
    const expected = ['api', 'database', 'valkey', 'identity', 'identity-audit', 'attachments', 'calls', 'push', 'turn', 'web', 'admin', 'operations'];
    await expect.poll(async () => {
      const result = await systemHealth(page);
      expect(result.status).toBe(200);
      return result.body.components.filter((c: { id: string; status: string }) => expected.includes(c.id) && c.status === 'UP').map((c: { id: string }) => c.id).sort();
    }, { timeout: 45_000 }).toEqual([...expected].sort());
    const response = await systemHealth(page);
    expect(response.body.components).toHaveLength(13);
    expect(JSON.stringify(response.body)).not.toMatch(/clientSecret|accessKey|secretKey|password=/);
    await adminGo(page, 'health');
    await expect(page.getByTestId('health-component-database')).toContainText('Healthy');
    await expect(page.getByTestId('health-overall')).toContainText('13 components');
    await page.screenshot({ path: 'test-results/admin-system-health.png', fullPage: true });
    const search = page.getByRole('textbox', { name: 'Search health components' });
    await search.fill('PostgreSQL');
    await expect(page.locator('.health-component-tile')).toHaveCount(1);
    await page.getByTestId('health-component-database').click();
    await expect(page.getByRole('dialog')).toContainText('SELECT 1');
    await page.goBack(); await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(search).toHaveValue('PostgreSQL');
    await search.fill('');
    await page.getByRole('tab', { name: 'Push delivery', exact: true }).click();
    await expect(page.getByText('Failed wake-ups', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'System health', exact: true })).toHaveAttribute('aria-selected', 'true');
  } finally { await closeAll(page); }
});

test('degraded and disabled services remain explicit when a refresh fails', async ({ browser, request }) => {
  const user = await createUser(request, 'healthfailure', { realmRoles: ['convo-admin'] });
  const page = await newPage(browser);
  try {
    await adminSignIn(page, user);
    const original = (await systemHealth(page)).body;
    let failed = false;
    await page.route('**/v1/admin/health/system', async (route) => {
      if (failed) { await route.fulfill({ status: 503, json: { detail: 'Health temporarily unavailable' } }); return; }
      await route.fulfill({ json: { ...original, status: 'DEGRADED', components: original.components.map((c: { id: string }) => c.id === 'calls' ? { ...c, status: 'DOWN', detail: 'Check timed out.' } : c.id === 'web-push' ? { ...c, status: 'DISABLED', detail: 'Browser push is disabled.' } : c) } });
    });
    await adminGo(page, 'health');
    await expect(page.getByTestId('health-overall')).toContainText('Some components need attention');
    await expect(page.getByTestId('health-component-calls')).toContainText('Unavailable');
    await expect(page.getByTestId('health-component-web-push')).toContainText('Disabled');
    await page.getByRole('combobox', { name: 'Filter health status' }).press('ArrowDown');
    await page.locator('.ant-select-item-option').filter({ hasText: /^Unavailable$/ }).click();
    await expect(page.locator('.health-component-tile')).toHaveCount(1);
    await page.getByTestId('health-component-calls').click();
    await expect(page.getByRole('dialog')).toContainText('Check timed out.');
    await page.goBack(); await page.goBack();
    await expect(page.locator('.health-component-tile')).toHaveCount(13);
    failed = true;
    await page.getByTestId('admin-health-refresh').click();
    await expect(page.getByText('Could not refresh system health. Showing the last available checks.')).toBeVisible();
    await expect(page.getByTestId('health-component-calls')).toContainText('Unavailable');
    await page.screenshot({ path: 'test-results/admin-health-degraded.png', fullPage: true });
  } finally { await closeAll(page); }
});

test('audit-only roles cannot access system health', async ({ browser, request }) => {
  const user = await createUser(request, 'healthdenied', { realmRoles: ['convo-auditor'] });
  const page = await newPage(browser);
  try {
    await adminSignIn(page, user);
    await expect(page.getByTestId('admin-tab-health')).toHaveCount(0);
    expect((await systemHealth(page)).status).toBe(403);
  } finally { await closeAll(page); }
});
