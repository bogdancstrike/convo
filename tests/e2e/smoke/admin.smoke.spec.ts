import { expect, test } from '@playwright/test';

/**
 * The admin console's origin (separate from the messenger): it serves the console, the admin API
 * and the realm's sign-in only. The messenger origin serves no admin UI.
 */
const ADMIN = process.env.ADMIN_URL ?? 'https://convo-admin.doncik.ro';

test('the admin origin exposes only the console, /v1/admin and realm sign-in', async ({ request }) => {
  const console = await request.get(`${ADMIN}/`);
  expect(console.status()).toBe(200);
  expect(console.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(console.headers()['x-frame-options']).toBe('DENY');
  expect((await request.get(`${ADMIN}/v1/admin/me`)).status()).toBe(401);
  for (const path of ['/v1/deployment-info', '/v1/devices', '/auth/admin/', '/auth/realms/master/', '/auth/realms/enclave/account/', '/actuator/health']) {
    expect((await request.get(`${ADMIN}${path}`, { maxRedirects: 0 })).status(), path).toBe(404);
  }
  const oidc = await (await request.get(`${ADMIN}/auth/realms/enclave/.well-known/openid-configuration`)).json();
  expect(oidc.issuer).toBe(`${ADMIN}/auth/realms/enclave`);
});

test('the messenger origin serves no admin console', async ({ request }) => {
  for (const path of ['/admin', '/auth/convo/admin']) expect((await request.get(path)).status(), path).toBe(404);
});
