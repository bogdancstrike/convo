import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, startChat, send, signIn } from './support';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');

test('Settings overview fits the viewport; categories, profile and confirmed logout remain accessible', async ({ browser, request }, testInfo) => {
  const user = await createUser(request, 'settings'); const page = await newPage(browser); await enroll(page, user);
  await page.getByTestId('nav-settings').click();
  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 1366, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const overview = page.getByTestId('settings-overview'); await expect(overview).toBeVisible();
    await expect.poll(() => overview.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), { message: `Overview fits ${size.width}×${size.height}` }).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(overview.getByTestId('log-out')).toBeInViewport();
    if (size.width === 1280) await page.screenshot({ path: testInfo.outputPath('settings-desktop.png') });
    if (size.width === 390) await page.screenshot({ path: testInfo.outputPath('settings-mobile.png') });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByTestId('settings-log-out')).toBeInViewport();
  await page.getByTestId('settings-card-all-media').click();
  await expect(page.getByTestId('all-media')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings-overview')).toBeVisible();
  const buttons = page.locator('.settings-navigation').getByRole('button');
  await expect(buttons.last()).toHaveText('Log out');
  page.once('dialog', (d) => void d.dismiss()); await page.getByTestId('settings-log-out').click();
  await expect(page.getByTestId('nav-settings')).toBeVisible();
  await page.getByTestId('settings-card-profile').click();
  await page.getByTestId('profile-status').fill('Available after lunch'); await page.getByTestId('save-profile-status').click();
  await expect(page.getByTestId('save-profile-status')).toBeDisabled();
  await page.getByTestId('profile-photo-input').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.profile-heading .avatar img')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('settings-overview')).toContainText('Available after lunch');
  await page.getByTestId('settings-card-chats').click();
  await expect(page.locator('.wallpaper-preview')).toHaveCount(4);
  await expect(page.getByTestId('toggle-animations')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('toggle-animations').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('toggle-animations')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('toggle-animations').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
  await page.getByTestId('wallpaper-ocean').click();
  await expect(page.getByTestId('wallpaper-ocean')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('settings-security')).toHaveCount(0);
  page.once('dialog', (d) => void d.dismiss()); await page.getByTestId('settings-log-out').click();
  await expect(page.getByTestId('nav-settings')).toBeVisible();
  page.once('dialog', (d) => void d.accept()); await page.getByTestId('settings-log-out').click();
  await expect(page.getByRole('alert')).toContainText('before logging out of your last device');
  await expect(page.getByTestId('nav-settings')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('settings-card-recovery').click();
  await expect(page.getByTestId('history-status')).toContainText('History is safely synced');
  await expect(page.getByTestId('create-recovery-code')).toBeVisible();
  await page.getByTestId('create-recovery-code').click();
  await expect(page.getByTestId('recovery-code')).toBeVisible();
  await page.getByRole('button', { name: 'I saved my code', exact: true }).click();
  await expect(page.getByTestId('settings-security')).toHaveCount(0);
  page.once('dialog', (d) => void d.accept()); await page.getByTestId('settings-log-out').click();
  await expect(page.getByRole('button', { name: 'Sign in with your organization' })).toBeVisible();
  await closeAll(page);
});

test('last seen is opt-in and hiding removes the value returned to other accounts', async ({ browser, request }) => {
  const [a, b] = await Promise.all(['presence', 'observer'].map((p) => createUser(request, p)));
  const [owner, observer] = await Promise.all([newPage(browser), newPage(browser)]);
  await enroll(owner, a); await enroll(observer, b);
  await startChat(owner, b); await send(owner, 'Hello from a private account');
  await observer.getByTestId(`conversation-${a.name}`).click();
  await expect(observer.getByTestId('last-seen')).toHaveCount(0);
  await owner.getByTestId('nav-settings').click(); await owner.getByTestId('settings-card-privacy').click();
  const toggle = owner.getByTestId('toggle-last-seen'); await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'false'); await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(observer.getByTestId('last-seen')).toHaveText(/^Last seen today: \d{2}:\d{2}$/);
  await owner.reload({ waitUntil: 'domcontentloaded' }); await expect(owner.getByTestId('toggle-last-seen')).toHaveAttribute('aria-checked', 'true');
  const hidden = observer.waitForResponse((r) => r.url().endsWith('/last-seen') && r.request().method() === 'GET');
  await owner.getByTestId('toggle-last-seen').click();
  await expect(owner.getByTestId('toggle-last-seen')).toHaveAttribute('aria-checked', 'false');
  await expect(observer.getByTestId('last-seen')).toHaveCount(0);
  expect((await (await hidden).json()).day).toBeNull();
  const anonymous = await request.get('/v1/privacy/last-seen'); expect(anonymous.status()).toBe(401);
  await closeAll(owner, observer);
});

test('first sign-in requires an editable phone number before enrollment', async ({ browser, request }) => {
  const user = await createUser(request, 'phone', { omitPhone: true, requiredActions: ['UPDATE_PROFILE'] });
  const page = await newPage(browser); await signIn(page, user);
  const phone = page.locator('input[name="phoneNumber"]'); await expect(phone).toBeVisible(); await expect(phone).toBeEditable();
  await phone.fill(''); await page.locator('input[type="submit"], button[type="submit"]').click();
  await expect(phone).toBeVisible(); await expect(page.getByTestId('nav-settings')).toHaveCount(0);
  await phone.fill(user.phone); await page.locator('input[type="submit"], button[type="submit"]').click();
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 45000 });
  await closeAll(page);
});

test('external links ask for confirmation unless the user turns it off', async ({ browser, request }) => {
  const user = await createUser(request, 'linkpref'); const page = await newPage(browser); await enroll(page, user);
  await page.getByTestId('new-chat').click(); await page.getByTestId('note-to-self').click(); await send(page, 'Read https://example.test/article');
  const link = page.getByTestId('message-body').getByRole('link'); await expect(link).toHaveAttribute('href', 'https://example.test/article');
  await link.click();
  const dialog = page.getByRole('dialog', { name: 'Open an external link?' });
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText('https://example.test/article');
  await expect(dialog.getByRole('link', { name: 'Open link' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('external-link-confirmation.png') });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); expect(page.context().pages()).toHaveLength(1);
  await page.context().route('https://example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>External destination</p>' }));
  await link.click(); const [confirmed] = await Promise.all([page.waitForEvent('popup'), dialog.getByRole('link', { name: 'Open link' }).click()]);
  await expect(confirmed).toHaveURL('https://example.test/article'); await confirmed.close(); await expect(dialog).toHaveCount(0);
  await page.getByTestId('nav-settings').click(); await page.getByTestId('settings-card-privacy').click();
  await page.getByTestId('toggle-link-confirmation').click();
  await page.getByTestId('nav-chats').click(); await page.locator('.chat-row > button.row').filter({ has: page.locator('.row-title').getByText('Note to self', { exact: true }) }).click();
  await page.context().route('https://example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>External destination</p>' }));
  page.once('dialog', (d) => { void d.dismiss(); throw new Error('Confirmation should be disabled'); });
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('message-body').getByRole('link').click()]);
  await expect(popup).toHaveURL('https://example.test/article'); await popup.close();
  await closeAll(page);
});

test('passkey status is read from the identity provider; no link to its account console', async ({ browser, request }) => {
  const user = await createUser(request, 'nopasskey');
  const page = await newPage(browser);
  try {
    await enroll(page, user);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-card-privacy').click();
    await expect(page.getByTestId('passkey-status')).toHaveAttribute('data-state', 'false');
    await expect(page.getByTestId('passkey-status')).toContainText('No passkey yet');
    await expect(page.getByTestId('setup-passkey')).toHaveAttribute('href', /kc_action=webauthn-register-passwordless/);
    await expect(page.locator('a[href*="/account"]')).toHaveCount(0);
  } finally { await closeAll(page); }
});
