import { expect, test, type Page } from '@playwright/test';
import { ADMIN_URL, adminGo, adminSignIn, closeAll, createUser, enroll, newPage, signIn, startChat, send } from './support';

async function adminApi(page: Page, path: string) {
  return page.evaluate(async (url) => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
    const token = JSON.parse(sessionStorage.getItem(key)!).access_token;
    const response = await fetch(`/v1/admin${url}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Admin API returned ${response.status}`);
    return response.json();
  }, path);
}

test('merged workspace, scoped activity, role explorer and renewable sessions', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const adminU = await createUser(request, 'workspaceadmin', { realmRoles: ['convo-admin'] });
  const memberU = await createUser(request, 'workspaceperson');
  const pendingU = await createUser(request, 'workspacepending', { realmRoles: ['convo-helpdesk'] });
  const [admin, member] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    await enroll(member, memberU);
    await adminSignIn(admin, adminU);
    await expect(admin.getByTestId('admin-tab-sign-in')).toHaveCount(0);
    await expect(admin.getByTestId('admin-tab-activity')).toHaveCount(0);
    await admin.getByTestId('admin-tab-users').click();
    await admin.getByTestId('admin-search').fill(pendingU.username);
    await expect(admin.getByTestId(`idp-user-${pendingU.username}`)).toContainText('Not joined yet');
    await admin.getByTestId('admin-search').fill(memberU.username);
    await expect(admin.getByTestId(`admin-account-${memberU.username}`)).toContainText(memberU.name);
    await expect(admin.getByText('Manage sign-in', { exact: true })).toHaveCount(0);
    await admin.getByTestId(`admin-account-${memberU.username}`).getByRole('button', { name: memberU.name }).click();
    await admin.getByTestId('user-drawer').getByRole('tab', { name: 'Security' }).click();
    await expect(admin.getByTestId('user-drawer').getByTestId('signin-reset-password')).toBeVisible();
    await admin.getByTestId('maximize-view').click();
    await expect(admin.getByTestId('user-full-page')).toBeVisible();
    await expect(admin.getByTestId('user-full-page').getByTestId('signin-reset-password')).toBeVisible();
    await admin.goBack();
    await expect(admin.getByTestId('user-drawer')).toBeVisible();
    const accounts = await adminApi(admin, `/accounts?q=${memberU.username}`);
    const account = accounts[0].accountId;
    await adminGo(admin, `activity/${account}`);
    await expect(admin).toHaveURL(new RegExp(`#/overview/${account}(?:\\?.*)?$`));
    await expect(admin.getByTestId('person-activity')).toContainText(memberU.username);
    await expect(admin.getByTestId('kpi-accounts')).toHaveCount(0);
    await admin.getByTestId('overview-window').getByText('7d', { exact: true }).click();
    await expect(admin.getByTestId('person-activity')).toContainText('/ 7');
    await admin.getByRole('button', { name: 'All users', exact: true }).click();
    await expect(admin.getByTestId('kpi-accounts')).toBeVisible();
    await admin.getByRole('tab', { name: 'Adoption & engagement' }).click();
    await expect(admin.getByTestId('activity-kpi-active')).toBeVisible();
    await admin.getByRole('tab', { name: 'People', exact: true }).click();
    await expect(admin.getByTestId('activity-top').getByRole('row').nth(1)).toBeVisible();
    const peopleWidth = async () => admin.getByTestId('activity-top').evaluate((e) => ({ card: e.getBoundingClientRect().width, table: e.querySelector('.remote-table')!.getBoundingClientRect().width, right: e.getBoundingClientRect().right, viewport: innerWidth }));
    await expect.poll(async () => { const r = await peopleWidth(); return r.table <= r.card && r.right <= r.viewport; }).toBe(true);
    await expect(admin.getByTestId('new-people-chart')).toBeVisible();
    await admin.screenshot({ path: 'test-results/admin-people-layout.png', fullPage: true });


    await adminGo(admin, 'roles');
    await admin.getByRole('button', { name: /Helpdesk.*permissions/ }).click();
    await admin.getByPlaceholder('Search name or username').fill(pendingU.username);
    await expect(admin.getByTestId('role-card-convo-helpdesk')).toContainText(pendingU.username);
    await expect(admin.getByTestId('role-card-convo-helpdesk')).toContainText(pendingU.phone);
    const phoneMatch = await adminApi(admin, `/tables/role-holders?role=convo-helpdesk&f_phone=${encodeURIComponent(pendingU.phone)}`);
    expect(phoneMatch.total).toBe(1);
    await admin.getByRole('tab', { name: 'Compare permissions' }).click();
    await expect(admin.getByRole('cell', { name: 'Grant and remove admin roles' })).toBeVisible();
    await admin.getByRole('tab', { name: 'Organization chart' }).click();
    const graph = admin.getByTestId('role-organigram');
    await expect(graph.locator('.react-flow__node').first()).toBeVisible();
    await graph.getByPlaceholder('Search people or roles').fill(pendingU.username);
    await graph.locator('.react-flow__node').filter({ hasText: `@${pendingU.username}` }).click();
    await expect(admin.getByTestId('organization-details')).toContainText(pendingU.username);
    await admin.getByTestId('organization-details').getByRole('button', { name: 'Open user', exact: true }).click();
    await expect(admin.getByTestId('user-drawer')).toContainText(pendingU.username);
    const identity = await adminApi(admin, `/idp/users?q=${pendingU.username}`);
    await adminGo(admin, `sign-in/${identity[0].user.id}`);
    await expect(admin).toHaveURL(new RegExp(`#/users/sign-in/${identity[0].user.id}(?:\\?.*)?$`));

    // The OIDC refresh token survives access-token expiry, including a sleeping tab/reload.
    await admin.evaluate(() => {
      const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!;
      const saved = JSON.parse(sessionStorage.getItem(key)!);
      saved.expires_at = Math.floor(Date.now() / 1000) - 10;
      sessionStorage.setItem(key, JSON.stringify(saved));
    });
    const refresh = admin.waitForRequest((r) => r.url().endsWith('/openid-connect/token') && (r.postData() ?? '').includes('refresh_token'));
    await admin.reload(); await refresh;
    await expect(admin.getByTestId('admin-name')).toContainText(adminU.username);
    await adminGo(admin, 'overview');
    await expect(admin.getByTestId('kpi-accounts')).toBeVisible();
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.screenshot({ path: 'test-results/admin-overview-mobile.png', fullPage: true });
  } finally { await closeAll(admin, member); }
});

test('identity audit records real login, device linking, removal and logout without duplicates', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const adminU = await createUser(request, 'auditobserver', { realmRoles: ['convo-admin'] });
  const memberU = await createUser(request, 'auditedperson');
  const [admin, member, linked] = await Promise.all([newPage(browser), newPage(browser), newPage(browser)]);
  try {
    await enroll(member, memberU);
    await signIn(linked, memberU);
    await expect(linked.getByTestId('link-code')).toBeVisible({ timeout: 45_000 });
    await member.getByTestId('nav-settings').click(); await member.getByTestId('settings-devices').click();
    await member.getByTestId('link-request').getByRole('button', { name: 'Codes match — approve' }).click();
    await expect(linked.getByTestId('nav-settings')).toBeVisible({ timeout: 30_000 });
    await expect(member.getByTestId('device-row')).toHaveCount(2);
    member.once('dialog', (d) => void d.accept());
    await member.getByTestId('device-row').getByRole('button', { name: 'Unlink', exact: true }).click();
    await expect(member.getByTestId('device-row')).toHaveCount(1);
    await adminSignIn(admin, adminU);
    const identity = (await adminApi(admin, `/idp/users?q=${memberU.username}`))[0];
    const user = `${identity.user.id},${identity.convoAccountId}`;
    await expect.poll(async () => (await adminApi(admin, `/audit?user=${encodeURIComponent(user)}&limit=100`)).map((e: { action: string }) => e.action), { timeout: 45_000 }).toEqual(expect.arrayContaining(['device.add', 'device.link-request', 'device.link-approve', 'device.remove', 'auth.login']));
    await expect.poll(async () => (await adminApi(admin, `/audit?user=${encodeURIComponent(user)}&action=auth.login`)).length, { timeout: 45_000 }).toBe(2);
    const events = await adminApi(admin, `/audit?user=${encodeURIComponent(user)}&limit=100`);
    const loginSeqs = events.filter((e: { action: string }) => e.action === 'auth.login').map((e: { seq: number }) => e.seq);
    expect(loginSeqs.length).toBe(2);
    const source = await adminApi(admin, '/audit/sources'); expect(source.configured).toBe(true); expect(source.error).toBeFalsy();
    await expect.poll(async () => (await adminApi(admin, '/audit/sources')).lastSuccess, { timeout: 30_000 }).not.toBe(source.lastSuccess);
    const again = await adminApi(admin, `/audit?user=${encodeURIComponent(user)}&action=auth.login&limit=100`);
    expect(again.map((e: { seq: number }) => e.seq).sort()).toEqual(loginSeqs.sort());
    await adminGo(admin, 'audit');
    await admin.getByTestId('audit-search').fill(memberU.username);
    await expect(admin.getByTestId('admin-audit-entry').filter({ hasText: 'device.add' })).toHaveCount(2);
    await admin.getByTestId('admin-verify').click();
    await expect(admin.getByTestId('admin-verification')).toContainText('Chain intact');
    await admin.getByTestId('audit-search').fill('');
    await admin.screenshot({ path: 'test-results/admin-audit-desktop.png', fullPage: true });
    // Real RP-initiated logout at Keycloak, observed by a second admin session.
    const observer = await newPage(browser);
    try {
      await adminSignIn(observer, adminU);
      const subject = await admin.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'))!)!).profile.sub);
      await admin.getByTestId('admin-name').hover();
      await admin.getByRole('menuitem', { name: 'Sign out' }).click();
      await expect(admin.getByTestId('admin-sign-in')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await adminApi(observer, `/audit?user=${subject}&action=auth.logout`)).length, { timeout: 45_000 }).toBeGreaterThan(0);
    } finally { await closeAll(observer); }
  } finally { await closeAll(admin, member, linked); }
});

test('passkey registration is captured from Keycloak', async ({ browser, browserName, baseURL, request }) => {
  test.skip(browserName !== 'chromium' || new URL(baseURL!).hostname !== 'convo.doncik.ro', 'Needs deployment RP hostname and Chromium virtual authenticator');
  test.setTimeout(120_000);
  const adminU = await createUser(request, 'passkeyauditor', { realmRoles: ['convo-admin'] });
  const user = await createUser(request, 'passkeyaudited');
  const [admin, member] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    const cdp = await member.context().newCDPSession(member);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    member.on('dialog', (d) => void d.accept('Audit test passkey'));
    await enroll(member, user);
    await member.getByTestId('nav-settings').click(); await member.getByTestId('settings-card-privacy').click();
    await member.goto((await member.getByTestId('setup-passkey').getAttribute('href'))!);
    await member.locator('#registerWebAuthn').click();
    await expect(member.getByRole('heading', { name: 'Your passkey is ready' })).toBeVisible();
    await adminSignIn(admin, adminU);
    const identity = (await adminApi(admin, `/idp/users?q=${user.username}`))[0];
    await expect.poll(async () => (await adminApi(admin, `/audit?user=${identity.user.id}&action=passkey.add`)).length, { timeout: 45_000 }).toBe(1);
  } finally { await closeAll(admin, member); }
});

test('overview person picker keeps its width while searching', async ({ browser, request }) => {
  const user = await createUser(request, 'pickeradmin', { realmRoles: ['convo-admin'] });
  const member = await createUser(request, 'pickerperson');
  const [admin, person] = await Promise.all([newPage(browser), newPage(browser)]);
  try {
    await enroll(person, member); await adminSignIn(admin, user);
    const picker = admin.getByTestId('activity-search');
    await expect(picker).toBeVisible();
    const original = (await picker.boundingBox())!.width;
    for (const letter of member.username) await picker.locator('input').pressSequentially(letter);
    const typed = (await picker.boundingBox())!.width;
    await admin.screenshot({ path: 'test-results/overview-picker-search.png', fullPage: true });
    expect(typed).toBeGreaterThanOrEqual(280); expect(Math.abs(typed - original)).toBeLessThan(2);
    await expect(admin.locator('.ant-select-item-option').filter({ hasText: member.username })).toBeVisible();
  } finally { await closeAll(admin, person); }
});

test('Back restores graph scope and filters; diagram details and sidebar controls work', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const user = await createUser(request, 'historyadmin', { realmRoles: ['convo-admin'] });
  const page = await newPage(browser);
  try {
    await adminSignIn(page, user);
    await page.getByTestId('sidebar-toggle').click(); await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('sidebar-toggle').click(); await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');
    await adminGo(page, 'roles');
    await page.getByRole('tab', { name: 'Organization chart' }).click();
    const graph = page.getByTestId('role-organigram');
    await expect(graph.locator('.react-flow__node')).toHaveCount(8);
    await graph.locator('.react-flow__node[data-id="role:convo-helpdesk"]').click();
    await expect(page.getByTestId('organization-details')).toContainText('Helpdesk');
    await expect(page).toHaveURL(/chartRole=convo-helpdesk/);
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'Organization chart' })).toHaveAttribute('aria-selected', 'true');
    await expect(graph.locator('.react-flow__node')).toHaveCount(8);
    await page.getByRole('tab', { name: 'Permission map' }).click();
    const map = page.getByTestId('permission-map');
    await map.locator('[data-id="convo-helpdesk"]').hover();
    await expect(map.locator('[data-id="convo-helpdesk"]')).toHaveClass(/permission-focused/);
    await expect(map.locator('.permission-edge-highlighted')).not.toHaveCount(0);
    await map.locator('[data-id="ROLES_MANAGE"]').hover();
    await expect(map.locator('[data-id="ROLES_MANAGE"]')).toHaveClass(/permission-focused/);
    await expect(map.locator('.permission-edge-highlighted')).toHaveCount(1);
    await page.getByRole('tab', { name: 'How access works' }).click();
    await page.getByTestId('access-flow').locator('[data-id="stepup"]').click();
    await expect(page.getByTestId('access-details')).toContainText('ten minutes');
    await page.goBack(); await expect(page.getByTestId('access-details')).not.toBeVisible();
    await page.getByRole('tab', { name: 'Role explorer' }).click();
    await page.getByRole('button', { name: /Helpdesk.*permissions/ }).click();
    await page.getByPlaceholder('Search name or username').fill('remember-search');
    await page.getByTestId('admin-tab-users').click();
    await page.goBack();
    await expect(page.getByPlaceholder('Search name or username')).toHaveValue('remember-search');
    await page.screenshot({ path: 'test-results/admin-role-explorer.png', fullPage: true });
  } finally { await closeAll(page); }
});

test('organization details scroll internally without enlarging the page', async ({ browser, request }) => {
  const user = await createUser(request, 'scrolladmin', { realmRoles: ['convo-admin'] });
  const page = await newPage(browser);
  try {
    await page.setViewportSize({ width: 1500, height: 900 });
    await adminSignIn(page, user); await adminGo(page, 'roles?tab=organization');
    const graph = page.getByTestId('role-organigram');
    await expect(graph.locator('.react-flow__node')).toHaveCount(8);
    const before = await page.evaluate(() => document.documentElement.scrollHeight);
    await graph.locator('[data-id="role:convo-admin"]').click();
    const inspector = page.getByTestId('organization-details');
    await expect(inspector).toContainText('Effective permissions');
    const after = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(after).toBeLessThanOrEqual(before + 2);
    await expect.poll(() => inspector.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await inspector.evaluate((e) => { e.scrollTop = 200; });
    expect(await inspector.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/admin-organization-desktop.png', fullPage: true });
  } finally { await closeAll(page); }
});

test('system throughput reports accepted operations per minute', async ({ browser, request }) => {
  const user = await createUser(request, 'throughputadmin', { realmRoles: ['convo-admin'] });
  const member = await createUser(request, 'throughputsender');
  const peerU = await createUser(request, 'throughputpeer');
  const [page, person, peer] = await Promise.all([newPage(browser), newPage(browser), newPage(browser)]);
  try {
    await enroll(person, member); await enroll(peer, peerU); await adminSignIn(page, user);
    const initial = await adminApi(page, '/stats/throughput?minutes=60');
    expect(initial.minutes).toHaveLength(60);
    const before = initial.minutes.reduce((sum: number, m: { items: number }) => sum + m.items, 0);
    await startChat(person, peerU); await send(person, 'throughput counter');
    await expect.poll(async () => (await adminApi(page, '/stats/throughput?minutes=60')).minutes.reduce((sum: number, m: { items: number }) => sum + m.items, 0)).toBeGreaterThan(before);
    await expect(page.getByRole('tab', { name: 'System throughput' })).toHaveCount(0);
    const throughput = page.getByTestId('system-throughput');
    await expect(throughput).toBeVisible();
    await expect(page.getByTestId('new-people-chart')).not.toBeVisible();
    const bounds = await throughput.boundingBox();
    const calls = await page.getByTestId('overview-calls').boundingBox();
    expect(Math.abs(bounds!.y - calls!.y)).toBeLessThan(2);
    expect(bounds!.x).toBeLessThan(calls!.x);
    await throughput.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/admin-throughput-overview.png', fullPage: true });
    await expect(page.getByTestId('system-throughput')).toContainText(/operations/i);
    const times = initial.minutes.map((m: { minute: string }) => Date.parse(m.minute));
    expect(times.slice(1).every((t: number, i: number) => t - times[i] === 60_000)).toBe(true);
  } finally { await closeAll(page, person, peer); }
});

test('table column settings and backend pagination, sorting and filtering', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const user = await createUser(request, 'tableadmin', { realmRoles: ['convo-admin'] });
  const page = await newPage(browser);
  try {
    await adminSignIn(page, user); await adminGo(page, 'audit');
    const ten = await adminApi(page, '/tables/audit?size=10&sort=seq&order=asc');
    expect(ten.rows).toHaveLength(10); expect(ten.total).toBeGreaterThan(10);
    const sequence = ten.rows.map((r: { seq: number }) => r.seq);
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
    const filtered = await adminApi(page, `/tables/audit?size=10&f_actor=${user.username}`);
    expect(filtered.total).toBeGreaterThan(0); expect(filtered.rows.every((r: { actorName: string }) => r.actorName === user.username)).toBe(true);
    await expect(page.getByTestId('admin-audit-entry').first()).toBeVisible();
    const table = page.getByTestId('admin-audit');
    await table.locator('.ant-pagination-options-size-changer').click();
    await page.locator('.ant-select-item-option').filter({ hasText: /^10 \/ page$/ }).click();
    await expect(table.getByTestId('admin-audit-entry')).toHaveCount(10);
    await page.getByTestId('table-settings-audit').click();
    await page.getByRole('checkbox', { name: 'Reason', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Reason', exact: true })).not.toBeChecked();
    await page.mouse.click(300, 30);
    await expect(table.getByRole('columnheader', { name: /Reason/ })).toHaveCount(0);
    await page.getByTestId('table-settings-audit').click(); await page.getByRole('button', { name: 'Reset display settings' }).click();
    await page.mouse.click(300, 30);
    await expect(table.getByRole('columnheader', { name: /Reason/ })).toHaveCount(1);
  } finally { await closeAll(page); }
});

test('user organization graph aligns identity, account and device cards and refits the available space', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const user = await createUser(request, 'graphadmin', { realmRoles: ['convo-admin'] });
  const member = await createUser(request, 'graphmember', { realmRoles: ['convo-helpdesk'] });
  const [page, person, linked] = await Promise.all([newPage(browser), newPage(browser), newPage(browser)]);
  let releaseDevices = () => {};
  try {
    await enroll(person, member);
    await signIn(linked, member);
    await expect(linked.getByTestId('link-code')).toBeVisible({ timeout: 45_000 });
    await person.getByTestId('nav-settings').click(); await person.getByTestId('settings-devices').click();
    await person.getByTestId('link-request').getByRole('button', { name: 'Codes match — approve' }).click();
    await expect(linked.getByTestId('nav-settings')).toBeVisible({ timeout: 30_000 });
    await adminSignIn(page, user);
    const account = (await adminApi(page, `/accounts?q=${member.username}`))[0];
    const deviceGate = new Promise<void>((resolve) => { releaseDevices = resolve; });
    await page.route('**/v1/admin/accounts/*/devices', async (route) => { await deviceGate; await route.continue(); });
    await adminGo(page, `users/${account.accountId}/organization?display=page`);
    const graph = page.getByTestId('user-organization');
    const panel = page.locator('.user-organization-panel');
    await expect(graph.locator('[data-id="person"]')).toContainText(member.name);
    await expect(graph.locator('[data-id="person"]')).toContainText(member.phone);
    await expect(graph.locator('.react-flow__node')).toHaveCount(5);
    releaseDevices();
    await expect(graph.locator('[data-id="device:1"]')).toContainText('Web browser');
    await expect(graph.locator('[data-id="device:2"]')).toContainText('Last active');
    // Chromium reports a horizontal SVG group's zero-height box as hidden.
    // Check the actual connector geometry instead.
    const connector = graph.locator('.react-flow__edge[data-id="account:device:1"] .react-flow__edge-path');
    await expect.poll(() => connector.evaluate((e) => (e as SVGGeometryElement).getTotalLength())).toBeGreaterThan(0);
    expect(await connector.getAttribute('d')).not.toContain('C');
    const aligned = async (ids: string[]) => graph.evaluate((element, keys) => {
      const centers = keys.map((id) => { const r = element.querySelector(`.react-flow__node[data-id="${id}"]`)!.getBoundingClientRect(); return r.y + r.height / 2; });
      return Math.max(...centers) - Math.min(...centers);
    }, ids);
    await expect.poll(() => aligned(['organization', 'person', 'account', 'device:1'])).toBeLessThan(1);
    await expect.poll(() => aligned(['identity', 'role:convo-helpdesk'])).toBeLessThan(1);
    const allCardsFit = () => graph.evaluate((element) => {
      const bounds = element.querySelector('.user-system-canvas')!.getBoundingClientRect();
      return Array.from(element.querySelectorAll('.react-flow__node')).every((node) => {
        const r = node.getBoundingClientRect();
        return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom;
      });
    });
    await expect.poll(allCardsFit).toBe(true);
    await page.screenshot({ path: 'test-results/admin-user-organization.png', fullPage: true });
    await page.getByTestId('sidebar-toggle').click();
    await expect.poll(async () => (await page.locator('.ant-layout-sider').boundingBox())!.width).toBe(64);
    await expect.poll(allCardsFit).toBe(true);
    await panel.getByRole('button', { name: 'Fit organization to view' }).click();
    await graph.locator('[data-id="device:1"]').click();
    await expect(page.getByRole('dialog')).toContainText('Device #1');
    await page.goBack();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const table = panel.getByRole('button', { name: 'Show diagram as table' });
    expect(await table.evaluate((e) => !!e.closest('.diagram-panel-header'))).toBe(true);
    await table.click();
    await expect(graph.getByRole('columnheader', { name: /Connections/ })).toBeVisible();
    await page.goBack();
    await expect(graph.locator('.react-flow__node')).toHaveCount(7);
  } finally { releaseDevices(); await closeAll(page, person, linked); }
});

test('data charts and diagrams can switch to inspectable tables and back', async ({ browser, request }) => {
  const user = await createUser(request, 'chartviewadmin', { realmRoles: ['convo-admin'] });
  const page = await newPage(browser);
  try {
    await adminSignIn(page, user);
    const tableSwitch = page.getByRole('button', { name: 'Show table: Encrypted items and active people per day', exact: true });
    await expect(tableSwitch).toBeVisible();
    expect(await tableSwitch.evaluate((e) => !!e.closest('.ant-card-head'))).toBe(true);
    await page.screenshot({ path: 'test-results/admin-chart-headers.png', fullPage: true });
    await tableSwitch.click();
    const values = page.getByLabel('Encrypted items and active people per day', { exact: true });
    await expect(values.getByRole('columnheader', { name: /Encrypted items/ })).toBeVisible();
    await expect(values.getByRole('columnheader', { name: /Active people/ })).toBeVisible();
    const resize = values.getByRole('separator').first();
    const originalWidth = await resize.evaluate((e) => e.closest('th')!.getBoundingClientRect().width);
    await resize.press('ArrowRight');
    await expect.poll(async () => await resize.evaluate((e) => e.closest('th')!.getBoundingClientRect().width) - originalWidth).toBeGreaterThan(7);

    await page.goBack(); await expect(page.getByRole('img', { name: 'Encrypted items and active people per day', exact: true })).toBeVisible();
    await adminGo(page, 'roles?tab=organization');
    const graph = page.getByTestId('role-organigram');
    const diagramSwitch = graph.getByRole('button', { name: 'Show diagram as table' });
    expect(await diagramSwitch.evaluate((e) => !!e.closest('.ant-card-head'))).toBe(true);
    await diagramSwitch.click();
    await expect(graph.getByRole('columnheader', { name: /Connections/ })).toBeVisible();
    await graph.getByRole('button', { name: 'Show diagram', exact: true }).click();
    await expect(graph.locator('.react-flow__node')).toHaveCount(8);
  } finally { await closeAll(page); }
});

test('sidebar footer keeps theme and role controls visible within the viewport', async ({ browser, request }) => {
  const user = await createUser(request, 'sidebaradmin', { realmRoles: ['convo-admin'] });
  const page = await newPage(browser);
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await adminSignIn(page, user);
    await expect(page.getByRole('switch', { name: 'Dark theme' })).toBeInViewport();
    await expect(page.getByTestId('admin-roles')).toBeInViewport();
    await expect(page.getByTestId('admin-tab-health')).toBeInViewport();
    const toggle = page.getByTestId('sidebar-toggle');
    expect(await toggle.evaluate((e) => !!e.closest('.sidebar-footer'))).toBe(true);
    expect((await toggle.boundingBox())!.y).toBeGreaterThan((await page.getByTestId('admin-name').boundingBox())!.y);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeInViewport();
    await expect(page.getByRole('switch', { name: 'Dark theme' })).toBeInViewport();
    await page.getByRole('switch', { name: 'Dark theme' }).click();
    await toggle.click();
    await expect(page.getByTestId('admin-name')).toBeVisible();
    await expect.poll(async () => (await page.locator('.ant-layout-sider').boundingBox())!.width).toBe(232);
    await page.mouse.move(1200, 16);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/admin-sidebar-dark.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toBeInViewport();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => (await page.locator('.ant-layout-sider').boundingBox())!.width).toBe(232);
    await page.mouse.move(380, 16);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('admin-roles')).toBeInViewport();
    await page.screenshot({ path: 'test-results/admin-sidebar-mobile.png', fullPage: true });
  } finally { await closeAll(page); }
});
