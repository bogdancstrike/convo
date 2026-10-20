import { expect, test } from '@playwright/test';
import { closeAll, createUser, newPage, signIn } from './support';

test('login card uses its full width on desktop and phones in both themes', async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto('/auth/realms/enclave/account/');
  await expect(page.locator('#username')).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1920, 1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const card = page.locator('.pf-v5-c-login__main');
      const bounds = (await card.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(width > 480 ? 470 : width - 34);
      expect(bounds.width).toBeLessThanOrEqual(480);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const language = (await page.locator('#login-select-toggle').boundingBox())!;
      expect(language.width).toBeGreaterThanOrEqual(100);
      await expect(page.locator('#username')).toBeInViewport();
      if (width === 1920 || width === 390) await page.screenshot({ path: test.info().outputPath(`login-${colorScheme}-${width}.png`) });
    }
    expect(await page.locator('#kc-header-wrapper').evaluate((el) => getComputedStyle(el).color))
      .toBe(colorScheme === 'dark' ? 'rgb(233, 237, 239)' : 'rgb(17, 27, 33)');
  }
  await closeAll(page);
});

test('Convo login fits a phone and keeps mandatory phone controls usable', async ({ browser, request }, testInfo) => {
  const user = await createUser(request, 'mobilelogin', { omitPhone: true, requiredActions: ['UPDATE_PROFILE'] });
  const page = await newPage(browser);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Sign in with your organization' }).click();
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('link[href*="css/convo.css"]')).toHaveCount(1);
  for (const selector of ['#username', '#password', '#kc-login']) {
    const control = page.locator(selector);
    await expect(control).toBeInViewport();
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('keycloak-phone-login.png') });
  await page.locator('#username').fill(user.username); await page.locator('#password').fill(user.password); await page.locator('#kc-login').click();
  const phone = page.locator('input[name="phoneNumber"]');
  await expect(phone).toHaveAttribute('type', 'tel'); await expect(phone).toBeEditable();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await phone.fill(user.phone); await page.locator('input[type="submit"], button[type="submit"]').click();
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 45000 });
  await closeAll(page);
});

test('hostname supports a real WebAuthn registration and passwordless sign-in', async ({ browser, browserName, request, baseURL }) => {
  test.skip(browserName !== 'chromium' || new URL(baseURL!).hostname !== 'convo.doncea.ro', 'Requires hostname and Chromium virtual authenticator');
  const user = await createUser(request, 'passkey', { requiredActions: ['webauthn-register-passwordless'] });
  const page = await newPage(browser);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } });
  page.on('dialog', (d) => void d.accept('Convo test passkey'));
  await signIn(page, user);
  await expect(page.locator('#registerWebAuthn')).toBeVisible();
  await page.locator('#registerWebAuthn').click();
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 45000 });
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials).toHaveLength(1); expect(credentials[0].rpId).toBe('convo.doncea.ro');
  // Convo learns only that a passkey exists (read-only service account), which gates native locks.
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-card-privacy').click();
  await expect(page.getByTestId('passkey-status')).toHaveAttribute('data-state', 'true');
  // Re-authenticate in Keycloak's account console with the same authenticator and no password.
  let assertions = 0;
  cdp.on('WebAuthn.credentialAsserted', () => { assertions++; });
  await page.context().clearCookies();
  await page.goto('/auth/realms/enclave/account/');
  // Keycloak's conditional UI can complete without rendering a username/password form.
  await expect(page.getByRole('heading', { name: /Personal info/i })).toBeVisible({ timeout: 30000 });
  expect(assertions, 'The second sign-in used the passkey, not an existing SSO session').toBeGreaterThan(0);
  await closeAll(page);
});
