import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send } from './support';

/**
 * Passwordless from Settings, then "require passkey to open" for a chat (web). Needs the
 * deployment hostname (the passkey RP ID) and Chromium's virtual authenticator.
 */
test('turn on passwordless in Settings, then lock and unlock a chat with the passkey', async ({ browser, browserName, request, baseURL }) => {
  test.skip(browserName !== 'chromium' || new URL(baseURL!).hostname !== 'convo.doncik.ro', 'Requires hostname and Chromium virtual authenticator');
  const user = await createUser(request, 'locker');
  const page = await newPage(browser);
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await enroll(page, user);

    // Passwordless is off: no lock options yet.
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-card-privacy').click();
    await expect(page.getByTestId('passkey-status')).toHaveAttribute('data-state', 'false');
    const setup = page.getByTestId('setup-passkey');
    await expect(setup).toHaveAttribute('target', '_blank');
    const href = await setup.getAttribute('href');
    expect(href).toContain('kc_action=webauthn-register-passwordless');
    // Same tab keeps the same virtual authenticator (CDP authenticators are per page).
    await page.goto(href!);
    await page.locator('#registerWebAuthn').click();
    await expect(page.getByRole('heading', { name: 'Your passkey is ready' })).toBeVisible();

    await page.goto('/');
    await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-card-privacy').click();
    await expect(page.getByTestId('passkey-status')).toHaveAttribute('data-state', 'true');

    // Note to self with a secret, then lock it from the chat list's ⋮ menu.
    await page.getByTestId('nav-chats').click();
    await page.getByTestId('new-chat').click(); await page.getByTestId('note-to-self').click();
    await send(page, 'locked secret 42');
    await page.getByTestId('nav-chats').click();
    const menuButton = page.locator('.chat-row-menu').first();
    await menuButton.click();
    await page.getByTestId('menu-lock').click();
    await expect(page.getByTestId('filter-locked')).toBeVisible();
    await expect(page.locator('.chat-row')).toHaveCount(0);
    await page.getByRole('searchbox').fill('secret 42');
    await expect(page.getByText('locked secret 42')).toHaveCount(0);
    await page.getByRole('searchbox').fill('');

    // Opening it (from the Locked chats list) asks for the passkey; leaving locks it again.
    await page.getByTestId('filter-locked').click();
    await page.locator('.chat-row > button.row').first().click();
    await expect(page.getByTestId('message-body').getByText('locked secret 42')).toBeVisible();
    // Closing the chat drops the grant; it is hidden from the list again.
    await page.getByTestId('thread-menu').click();
    await page.getByRole('menuitem', { name: 'Close chat' }).click();
    await expect(page.locator('.chat-row')).toHaveCount(0);
    // A reload or direct link shows the lock gate instead of the messages.
    const chatUrl = page.url();
    await page.getByTestId('filter-locked').click();
    await page.locator('.chat-row > button.row').first().click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 45_000 });
    expect(page.url()).not.toBe(chatUrl);
    await expect(page.getByTestId('locked-chat')).toBeVisible();
    await expect(page.getByText('locked secret 42')).toHaveCount(0);
    await page.getByTestId('unlock-chat').click();
    await expect(page.getByTestId('message-body').getByText('locked secret 42')).toBeVisible();

    // Turn it off from the chat info page.
    await page.getByTestId('thread-info').click();
    await page.getByTestId('info-lock').click();
    await expect(page.getByTestId('info-lock')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('nav-chats').click();
    await expect(page.getByTestId('filter-locked')).toHaveCount(0);
    await expect(page.locator('.chat-row')).toHaveCount(1);

    // App-wide lock: a reload shows only the lock screen until the passkey is confirmed.
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-card-privacy').click();
    await page.getByTestId('toggle-app-lock').click();
    await expect(page.getByTestId('toggle-app-lock')).toHaveAttribute('aria-checked', 'true');
    // Failed user verification keeps it locked; nothing behind the lock screen is rendered.
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('app-locked')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('nav-settings')).toHaveCount(0);
    await expect(page.getByText('locked secret 42')).toHaveCount(0);
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
    await page.getByTestId('unlock-app').click();
    await expect(page.getByTestId('nav-settings')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-card-privacy').click();
    await page.getByTestId('toggle-app-lock').click();
    await expect(page.getByTestId('toggle-app-lock')).toHaveAttribute('aria-checked', 'false');
  } finally { await closeAll(page); }
});
