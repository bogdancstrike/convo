import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage } from './support';

/**
 * Passkey management edge cases (Settings → Privacy → Passkeys). Chromium's virtual authenticator
 * on the real hostname (the WebAuthn RP ID); the result page must report what Keycloak did.
 */
test.skip(({ browserName, baseURL }) => browserName !== 'chromium' || new URL(baseURL!).hostname !== 'convo.doncik.ro',
  'Requires the deployment hostname and Chromium virtual authenticator');

async function privacy(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-card-privacy').click();
}

/** Keycloak asks for the passkey's name in a prompt; one handler answers with `nextName`. */
let nextName = '';
async function register(page: Page, name: string) {
  await page.goto((await page.getByTestId('setup-passkey').getAttribute('href'))!);
  nextName = name;
  await page.locator('#registerWebAuthn').click();
}

test('cancel, duplicate name and a second passkey are reported truthfully', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const user = await createUser(request, 'pkedge');
  const page = await newPage(browser);
  page.on('dialog', (d) => void d.accept(nextName));
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await enroll(page, user);
    await privacy(page);

    // Cancelling at Keycloak changes nothing, and the page says so.
    await page.goto((await page.getByTestId('setup-passkey').getAttribute('href'))!);
    await page.locator('#cancelWebAuthnAIA').click();
    await expect(page.getByRole('heading', { name: 'Nothing was changed' })).toBeVisible();
    await privacy(page);
    await expect(page.getByTestId('passkey-status')).toHaveAttribute('data-state', 'false');

    // First passkey.
    await register(page, 'Laptop');
    await expect(page.getByRole('heading', { name: 'Your passkey is ready' })).toBeVisible();
    await privacy(page);
    await expect(page.getByTestId('passkey-item')).toHaveText([/Laptop/]);

    // A second passkey with the same name is refused by Keycloak: no false success.
    // (a new authenticator: the first one is already registered and would be excluded)
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await register(page, 'Laptop');
    await expect(page.getByText('Device already exists with the same name')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your passkey is ready' })).toHaveCount(0);
    await privacy(page);
    await expect(page.getByTestId('passkey-item')).toHaveCount(1);

    // A distinct name works and both are listed.
    await register(page, 'Phone');
    await expect(page.getByRole('heading', { name: 'Your passkey is ready' })).toBeVisible();
    await privacy(page);
    await expect(page.getByTestId('passkey-item')).toHaveText([/Laptop/, /Phone/]);
  } finally { await closeAll(page); }
});
