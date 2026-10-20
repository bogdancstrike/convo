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
  /** Organization display name ("Ana Kx3pz"), shown as chat titles. */
  name: string;
  /** Unique organization phone number. */
  phone: string;
}

const random = () => Math.random().toString(36).slice(2, 7);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Creates a unique realm user, e.g. `ana-k3j9x` named "Ana K3j9x" with a unique phone number. */
export async function createUser(request: APIRequestContext, prefix: string): Promise<TestUser> {
  const tokenResponse = await request.post('/auth/realms/master/protocol/openid-connect/token', {
    form: { grant_type: 'password', client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PASSWORD },
  });
  expect(tokenResponse.ok(), 'Keycloak admin token').toBeTruthy();
  const { access_token: token } = (await tokenResponse.json()) as { access_token: string };
  const suffix = random();
  const user: TestUser = {
    username: `${prefix}-${suffix}`,
    password: `pw-${Math.random().toString(36).slice(2)}`,
    name: `${capitalize(prefix)} ${capitalize(suffix)}`,
    phone: `+40 7${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
  };
  const created = await request.post('/auth/admin/realms/enclave/users', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      username: user.username,
      enabled: true,
      email: `${user.username}@example.test`,
      emailVerified: true,
      firstName: capitalize(prefix),
      lastName: capitalize(suffix),
      attributes: { phoneNumber: [user.phone] },
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

/**
 * Signs in through Keycloak and registers this browser as the account's first device. Waits until
 * the device has published its MLS KeyPackages so it can be added to groups immediately.
 */
export async function enroll(page: Page, user: TestUser): Promise<void> {
  const keyPackagesUploaded = page.waitForResponse(
    (r) => r.url().endsWith('/v1/keypackages') && r.request().method() === 'PUT' && r.ok(),
    { timeout: 60_000 },
  );
  await signIn(page, user);
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
  await keyPackagesUploaded;
}

/** Opens a fresh, isolated browser profile with a page. Close it with `page.context().close()`. */
export async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Surface client-side warnings/errors in the test log; they are the first clue on failures.
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') console.log(`[browser ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[browser pageerror] ${e.message}`));
  return page;
}

/** Closes the browser profiles of the given pages (keeps failure snapshots focused). */
export async function closeAll(...pages: Page[]): Promise<void> {
  await Promise.all(pages.map((p) => p.context().close().catch(() => undefined)));
}

/** Starts a direct chat by searching the directory (by handle, name or phone). */
export async function startChat(page: Page, user: TestUser, query: string = user.username): Promise<void> {
  await page.getByTestId('new-chat').click();
  await page.getByTestId('directory-search').fill(query);
  await page.getByTestId(`directory-${user.username}`).click();
  await expect(page.getByTestId('thread-title')).toHaveText(user.name);
}

/** Opens an existing conversation from the chat list. */
export async function openChat(page: Page, title: string): Promise<void> {
  await page.getByTestId('nav-chats').click();
  await page.getByTestId(`conversation-${title}`).click();
  await expect(page.getByTestId('thread-title')).toHaveText(title);
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

/** Opens a message's menu via right-click (same menu as the hover chevron / long-press). */
export async function messageMenu(page: Page, text: string) {
  const bubble = message(page, text);
  await bubble.getByTestId('message-body').click({ button: 'right' });
  return bubble.getByTestId('message-menu-panel');
}
