import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Shared helpers: provision throwaway Keycloak users through the admin API (so every run starts
 * with accounts that have no devices) and drive the browser enrollment flow.
 */

const ADMIN_USER = process.env.KEYCLOAK_ADMIN ?? 'admin';
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin-dev-password';

export interface TestUser {
  username: string;
  password: string;
}

/** Creates a unique realm user, e.g. `ana-k3j9x`. */
export async function createUser(request: APIRequestContext, prefix: string): Promise<TestUser> {
  const tokenResponse = await request.post('/auth/realms/master/protocol/openid-connect/token', {
    form: { grant_type: 'password', client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PASSWORD },
  });
  expect(tokenResponse.ok(), 'Keycloak admin token').toBeTruthy();
  const { access_token: token } = (await tokenResponse.json()) as { access_token: string };
  const user: TestUser = {
    username: `${prefix}-${Math.random().toString(36).slice(2, 7)}`,
    password: `pw-${Math.random().toString(36).slice(2)}`,
  };
  const created = await request.post('/auth/admin/realms/enclave/users', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      username: user.username,
      enabled: true,
      email: `${user.username}@example.test`,
      emailVerified: true,
      firstName: prefix,
      lastName: 'Test',
      credentials: [{ type: 'password', value: user.password, temporary: false }],
    },
  });
  expect(created.status(), 'Keycloak user creation').toBe(201);
  return user;
}

/** Completes the Keycloak sign-in form after "Sign in with your organization". */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Sign in with your organization' }).click();
  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.locator('#kc-login').click();
}

/** Signs in through Keycloak and registers this browser as the account's first device. */
export async function enroll(page: Page, user: TestUser): Promise<void> {
  await signIn(page, user);
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
}

/** Opens a fresh, isolated browser profile with a page. Close it with `page.context().close()`. */
export async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** Closes the browser profiles of the given pages (keeps failure snapshots focused). */
export async function closeAll(...pages: Page[]): Promise<void> {
  await Promise.all(pages.map((p) => p.context().close().catch(() => undefined)));
}

/** Starts a direct chat with `username` via directory search. */
export async function startChat(page: Page, username: string): Promise<void> {
  await page.getByTestId('new-chat').click();
  await page.getByTestId('directory-search').fill(username);
  await page.getByTestId(`directory-${username}`).click();
  await expect(page.getByTestId('thread-title')).toHaveText(username);
}

/** Types and sends a message from the open conversation. */
export async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('composer').fill(text);
  await page.getByTestId('composer').press('Enter');
}

/** Locator of a message bubble containing `text`. */
export function message(page: Page, text: string) {
  return page.getByTestId('message').filter({ has: page.getByTestId('message-body').getByText(text, { exact: true }) });
}
