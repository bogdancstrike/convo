import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Passwordless end to end on the live deployment: Keycloak's registration action (the one Convo
 * Settings opens) creates a passkey bound to the hostname, and that passkey alone then signs in.
 * Uses Chromium's virtual authenticator and the dedicated smoke account.
 */
const username = process.env.SMOKE_USERNAME;
const password = process.env.SMOKE_PASSWORD;
test.skip(!username || !password, 'SMOKE_USERNAME / SMOKE_PASSWORD not set');

const b64 = (b: Buffer) => b.toString('base64url');
function authorize(baseURL: string, extra: Record<string, string>) {
  const params = new URLSearchParams({ client_id: 'enclave-web', response_type: 'code', scope: 'openid',
    state: `add.${b64(randomBytes(16))}`, code_challenge: b64(createHash('sha256').update(randomBytes(32)).digest()), code_challenge_method: 'S256', ...extra });
  return `${baseURL}/auth/realms/enclave/protocol/openid-connect/auth?${params}`;
}

test('register a passkey from Settings’ action, then sign in with it alone', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const name = `Smoke ${new Date().toISOString()}`;
  page.on('dialog', (d) => void d.accept(name));

  await page.goto(authorize(baseURL!, { redirect_uri: `${baseURL}/auth/convo/passkey-done`, kc_action: 'webauthn-register-passwordless' }));
  await page.locator('#username').fill(username!);
  await page.locator('#password').fill(password!);
  await page.locator('#kc-login').click();
  await page.locator('#registerWebAuthn').click();
  await expect(page).toHaveURL(/kc_action_status=success/);
  await expect(page.getByRole('heading', { name: 'Your passkey is ready' })).toBeVisible();
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials).toHaveLength(1);
  expect(credentials[0].rpId).toBe(new URL(baseURL!).hostname);

  // A fresh browser session: only the passkey, no password and no SSO cookie.
  await context.clearCookies();
  let assertions = 0;
  cdp.on('WebAuthn.credentialAsserted', () => { assertions++; });
  await page.goto(authorize(baseURL!, { redirect_uri: `${baseURL}/auth/convo/passkey-done` }));
  // Keycloak's conditional passkey UI may complete on its own; otherwise press "Sign in with Passkey".
  const signedIn = page.waitForURL(/\/auth\/convo\/passkey-done\?.*code=/);
  await Promise.race([signedIn, page.getByRole('button', { name: /Sign in with Passkey/i }).first().click().catch(() => undefined)]);
  await signedIn;
  expect(assertions).toBeGreaterThan(0);
  await context.close();
});
