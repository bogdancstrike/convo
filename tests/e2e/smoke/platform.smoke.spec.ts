import { expect, test } from '@playwright/test';

/** Public surface of a deployment: health, sign-in discovery, security headers, hidden consoles. */
test('deployment answers and advertises its own origin as the issuer', async ({ request, baseURL }) => {
  const info = await request.get('/v1/deployment-info');
  expect(info.status()).toBe(200);
  const body = await info.json();
  expect(body.apiVersions?.length).toBeGreaterThan(0);
  const oidc = await (await request.get('/auth/realms/enclave/.well-known/openid-configuration')).json();
  expect(oidc.issuer).toBe(`${baseURL}/auth/realms/enclave`);
  expect(oidc.code_challenge_methods_supported).toContain('S256');
});

test('the web app is served with strict security headers', async ({ request }) => {
  const page = await request.get('/');
  expect(page.status()).toBe(200);
  const h = page.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).not.toMatch(/'unsafe-eval'/); // 'wasm-unsafe-eval' (WebAssembly crypto) is allowed
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('no-referrer');
});

test('identity-provider consoles are not exposed on the public origin', async ({ request }) => {
  for (const path of ['/auth/admin/', '/auth/realms/master/', '/auth/realms/enclave/account/', '/actuator/health']) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
});

test('protected APIs refuse callers without a token and device signature', async ({ request }) => {
  for (const path of ['/v1/account/credentials', '/v1/admin/me', '/v1/admin/health', '/v1/devices']) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
  expect((await request.post('/v1/admin/push/redrive', { data: { reason: 'smoke' } })).status()).toBe(401);
});

test('the passkey result page reports Keycloak’s outcome, not a fixed success', async ({ page }) => {
  await page.goto('/auth/convo/passkey-done?kc_action_status=error');
  await expect(page.getByRole('heading', { level: 1 }).filter({ visible: true })).toHaveText('That did not finish');
  await page.goto('/auth/convo/passkey-done?kc_action_status=success&state=add.x');
  await expect(page.getByRole('heading', { level: 1 }).filter({ visible: true })).toHaveText('Your passkey is ready');
});
