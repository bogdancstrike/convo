import { expect, test } from '@playwright/test';
import { adminToken } from './support';

/**
 * Identity-provider configuration that Convo's security features depend on. These checks exist
 * because a realm import silently registers only the required actions its JSON lists: production
 * once lacked `webauthn-register-passwordless`, so passkey set-up from Settings could never work.
 * Runs against the realm the setup job maintains (deploy/keycloak/credential-status-client.sh).
 */
const HOSTNAME = process.env.CONVO_HOSTNAME ?? 'convo.doncik.ro';
const REQUIRED_ACTIONS = ['UPDATE_PROFILE', 'UPDATE_PASSWORD', 'CONFIGURE_TOTP', 'webauthn-register', 'webauthn-register-passwordless',
  'VERIFY_PROFILE', 'delete_credential'];

test.describe('identity provider configuration', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'configuration is browser-independent');

  test('every required action Convo opens is registered and enabled', async ({ request }) => {
    const token = await adminToken(request);
    const response = await request.get('/auth/admin/realms/enclave/authentication/required-actions', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok()).toBeTruthy();
    const actions = (await response.json()) as { alias: string; enabled: boolean }[];
    for (const alias of REQUIRED_ACTIONS) {
      expect(actions.find((a) => a.alias === alias), `required action ${alias}`).toMatchObject({ enabled: true });
    }
  });

  test('passkeys are bound to the deployment hostname and require user verification', async ({ request }) => {
    const token = await adminToken(request);
    const realm = await (await request.get('/auth/admin/realms/enclave', { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(realm.webAuthnPolicyPasswordlessRpId).toBe(HOSTNAME);
    expect(realm.webAuthnPolicyPasswordlessUserVerificationRequirement).toBe('required');
    expect(realm.webAuthnPolicyPasswordlessRequireResidentKey).toBe('Yes');
    expect(realm.registrationAllowed).toBe(false);
  });

  test('clients allow only Convo redirects (web result pages, Android app scheme)', async ({ request }) => {
    const token = await adminToken(request);
    const clients = (await (await request.get('/auth/admin/realms/enclave/clients', { headers: { Authorization: `Bearer ${token}` } })).json()) as
      { clientId: string; publicClient: boolean; redirectUris: string[]; attributes?: Record<string, string> }[];
    const web = clients.find((c) => c.clientId === 'enclave-web')!;
    expect(web.publicClient).toBe(true);
    expect(web.redirectUris.sort()).toEqual(['/convo/callback', '/convo/passkey-done']);
    // The admin console signs in through its own public PKCE client.
    const admin = clients.find((c) => c.clientId === 'convo-admin')!;
    expect(admin.publicClient).toBe(true);
    expect(admin.redirectUris).toEqual(['/convo/admin']);
    expect(admin.attributes?.['pkce.code.challenge.method']).toBe('S256');
    expect(web.redirectUris.some((u) => u.includes('*'))).toBe(false);
    expect(web.attributes?.['pkce.code.challenge.method']).toBe('S256');
    const android = clients.find((c) => c.clientId === 'convo-android')!;
    expect(android.redirectUris).toEqual(['com.convo.android:/oauth2redirect']);
    // The credential-status service account may only read users.
    const status = clients.find((c) => c.clientId === 'convo-credential-status');
    if (status) expect(status.publicClient).toBe(false);
  });

  test('credential status and admin APIs refuse unauthenticated callers', async ({ request }) => {
    for (const path of ['/v1/account/credentials', '/v1/account/credentials?refresh=true', '/v1/admin/health', '/v1/admin/me']) {
      expect((await request.get(path)).status(), path).toBe(401);
    }
  });
});
