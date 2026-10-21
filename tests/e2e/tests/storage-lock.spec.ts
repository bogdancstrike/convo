import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send } from './support';

/** WEB-01: browser passphrase lock (Argon2id-wrapped storage keys, auto-lock). */
async function openPrivacy(page: Page) {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-card-privacy').click();
}

async function setPassphrase(page: Page, prefix: 'new' | 'repeat', value: string) {
  await page.getByTestId(`storage-lock-${prefix}`).fill(value);
}

async function unlock(page: Page, passphrase: string) {
  await expect(page.getByTestId('storage-locked')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('storage-passphrase').fill(passphrase);
  await page.getByTestId('storage-unlock').click();
  await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 60_000 });
}

test('a passphrase locks this browser’s data, on demand and after inactivity', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const user = await createUser(request, 'locked');
  const page = await newPage(browser);
  try {
    await enroll(page, user);
    await page.getByTestId('new-chat').click(); await page.getByTestId('note-to-self').click();
    await send(page, 'kept behind the passphrase');

    await openPrivacy(page);
    await page.getByTestId('storage-lock-enable').click();
    await setPassphrase(page, 'new', 'short');
    await setPassphrase(page, 'repeat', 'short');
    await page.getByTestId('storage-lock-save').click();
    await expect(page.getByTestId('storage-lock-error')).toContainText('at least 10');
    await setPassphrase(page, 'new', 'blue whale over the moon');
    await setPassphrase(page, 'repeat', 'blue whale over the moon');
    await page.getByTestId('storage-lock-save').click();
    await expect(page.getByTestId('storage-lock-status')).toBeVisible({ timeout: 60_000 });

    // Lock now: the reload shows only the lock screen; nothing decrypted is rendered.
    await page.getByTestId('storage-lock-now').click();
    await expect(page.getByTestId('storage-locked')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('kept behind the passphrase')).toHaveCount(0);
    await page.getByTestId('storage-passphrase').fill('not the passphrase');
    await page.getByTestId('storage-unlock').click();
    await expect(page.getByTestId('storage-wrong')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('storage-passphrase').fill('blue whale over the moon');
    await page.getByTestId('storage-unlock').click();
    await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('nav-chats').click();
    await expect(page.locator('.chat-row').filter({ hasText: 'kept behind the passphrase' })).toBeVisible({ timeout: 30_000 });

    // Auto-lock after 1 minute without interaction.
    await openPrivacy(page);
    await page.getByTestId('storage-lock-after').getByRole('radio', { name: '1 min', exact: true }).click();
    await expect(page.getByTestId('storage-lock-after').getByRole('radio', { name: '1 min', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.clock.install();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await unlock(page, 'blue whale over the moon');
    await page.clock.fastForward('01:30');
    await expect(page.getByTestId('storage-locked')).toBeVisible({ timeout: 45_000 });
    await unlock(page, 'blue whale over the moon');

    // Change, then remove: afterwards the browser opens without asking.
    await openPrivacy(page);
    await page.getByTestId('storage-lock-change').click();
    await page.getByTestId('storage-lock-current').fill('blue whale over the moon');
    await setPassphrase(page, 'new', 'green turtle under the sea');
    await setPassphrase(page, 'repeat', 'green turtle under the sea');
    await page.getByTestId('storage-lock-save').click();
    await expect(page.getByTestId('storage-lock-change')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('storage-lock-remove').click();
    await page.getByTestId('storage-lock-current').fill('blue whale over the moon');
    await page.getByTestId('storage-lock-save').click();
    await expect(page.getByTestId('storage-lock-error')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('storage-lock-current').fill('green turtle under the sea');
    await page.getByTestId('storage-lock-save').click();
    await expect(page.getByTestId('storage-lock-enable')).toBeVisible({ timeout: 60_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('nav-settings')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('storage-locked')).toHaveCount(0);
  } finally { await closeAll(page); }
});
