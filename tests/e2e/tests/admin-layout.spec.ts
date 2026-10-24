import { expect, test, type Page } from '@playwright/test';
import { adminGo, adminSignIn, closeAll, createUser, newPage } from './support';

const headerWidths = (page: Page, testId: string) => page.getByTestId(testId).locator('.ant-table-header th:not(.ant-table-cell-scrollbar)').evaluateAll((headers) => headers.map((h) => h.getBoundingClientRect().width));
async function expectEqual(page: Page, testId: string) {
  await expect.poll(async () => { const widths = await headerWidths(page, testId); return widths.length ? Math.max(...widths) - Math.min(...widths) : Infinity; }).toBeLessThan(3);
}

test('all management columns start equal, drag without sorting and persist resized widths', async ({ browser, request }) => {
  const user = await createUser(request, 'sizingadmin', { realmRoles: ['convo-admin'] });
  const page = await newPage(browser);
  try {
    await page.setViewportSize({ width: 1600, height: 900 });
    await adminSignIn(page, user); await adminGo(page, 'audit');
    await expect(page.getByTestId('admin-audit-entry').first()).toBeVisible();
    await expectEqual(page, 'admin-audit');
    const before = await headerWidths(page, 'admin-audit');
    const url = page.url();
    const separator = page.getByTestId('admin-audit').getByRole('separator', { name: 'Resize Target column' });
    const bounds = (await separator.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 45, bounds.y + bounds.height / 2, { steps: 6 }); await page.mouse.up();
    await expect.poll(async () => (await headerWidths(page, 'admin-audit'))[4]! - before[4]!).toBeGreaterThan(35);
    expect(page.url()).toBe(url);
    await page.reload();
    await expect(page.getByTestId('admin-audit-entry').first()).toBeVisible();
    await expect.poll(async () => (await headerWidths(page, 'admin-audit'))[4]! - before[4]!).toBeGreaterThan(35);
    await page.getByTestId('table-settings-audit').click();
    await page.getByRole('button', { name: 'Reset equal column widths', exact: true }).click();
    await page.mouse.click(300, 30);
    await expect(page.getByRole('button', { name: 'Reset equal column widths', exact: true })).not.toBeVisible();
    await expectEqual(page, 'admin-audit');
    await page.screenshot({ path: 'test-results/admin-audit-equal-columns.png', fullPage: true });
    await adminGo(page, 'roles');
    await expect(page.getByTestId('role-holders-table').getByRole('columnheader', { name: /Phone/ })).toBeVisible();
    await expect(page.getByTestId('role-holders-table').locator('tbody tr.ant-table-row').first()).toBeVisible();
    await expectEqual(page, 'role-holders-table');
    await page.screenshot({ path: 'test-results/admin-roles-equal-columns.png', fullPage: true });
  } finally { await closeAll(page); }
});

test('overview date controls live in the scope card and support one day and custom ranges', async ({ browser, request }) => {
  const user = await createUser(request, 'rangedadmin', { realmRoles: ['convo-admin'] });
  const page = await newPage(browser);
  try {
    await adminSignIn(page, user);
    const picker = page.getByTestId('overview-window');
    expect(await picker.evaluate((e) => !!e.closest('.scope-bar'))).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const oneDay = page.waitForResponse((r) => r.url().includes('/stats/overview?') && r.url().includes('days=1&'));
    await picker.getByText('1d', { exact: true }).click();
    const single = await (await oneDay).json(); expect(single.days).toHaveLength(1); expect(single.days[0].day).toBe(today);
    await picker.getByText('Custom', { exact: true }).click();
    const start = page.getByPlaceholder('Start date'); const end = page.getByPlaceholder('End date');
    await start.fill('2020-01-02'); await start.press('Enter');
    const custom = page.waitForResponse((r) => r.url().includes('/stats/overview?') && r.url().includes('from=2020-01-02') && r.url().includes('to=2020-01-04'));
    await end.fill('2020-01-04'); await end.press('Enter');
    const report = await (await custom).json(); expect(report.days.map((d: { day: string }) => d.day)).toEqual(['2020-01-02', '2020-01-03', '2020-01-04']);
    await expect(page).toHaveURL(/from=2020-01-02/);
    await expect(start).toHaveValue('2020-01-02'); await expect(end).toHaveValue('2020-01-04');
    await picker.getByText('7d', { exact: true }).click();
    await expect(page.getByText('Last 7 days · UTC', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByPlaceholder('Start date')).toHaveValue('2020-01-02');
    await expect(page.getByPlaceholder('End date')).toHaveValue('2020-01-04');
    await page.getByRole('button', { name: 'About throughput', exact: true }).click();
    await expect(page.getByText('What throughput counts', { exact: true })).toBeVisible();
    await expect(page.getByText(/Recording began/)).toHaveCount(0);
    await page.mouse.click(300, 30);
    await page.screenshot({ path: 'test-results/admin-overview-custom-range.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await page.locator('.ant-layout-sider').boundingBox())!.width).toBe(64);
    await expect(picker).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await closeAll(page); }
});
