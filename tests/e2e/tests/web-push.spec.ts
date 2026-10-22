import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, send, startChat } from './support';

/**
 * Web Push for closed tabs (MSG-02): the browser subscribes with the deployment's VAPID key,
 * the server sends an empty VAPID-signed wake to the browser's push service while the device has
 * no connection, and the service worker shows a generic notification.
 *
 * The full flow needs a real push service: Firefox is pointed at Mozilla's autopush (internet
 * access required; set E2E_OFFLINE=1 to skip). Chromium cannot register a service worker over the
 * development stack's self-signed certificate, so it only checks the setting is offered.
 */
const FIREFOX_PUSH = {
  'dom.push.enabled': true, 'dom.push.connection.enabled': true, 'dom.push.serverURL': 'wss://push.services.mozilla.com/',
  'dom.serviceWorkers.enabled': true, 'dom.serviceWorkers.testing.enabled': true,
};

async function openNotificationSettings(page: Page) {
  await page.getByTestId('nav-settings').click();
  await page.getByText('Notifications', { exact: true }).first().click();
}

/** Notifications the service worker is showing (read from a same-origin page without the app). */
async function shownNotifications(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return (await reg?.getNotifications() ?? []).map((n) => n.body);
  });
}

test.describe('web push for closed tabs', () => {
  test('the setting is offered when the deployment has a VAPID key', async ({ browser, request }) => {
    const info = await (await request.get('/v1/deployment-info')).json();
    test.skip(!info.push?.webPushKey, 'Web Push is not enabled on this deployment');
    const user = await createUser(request, 'pushset');
    const page = await newPage(browser);
    await enroll(page, user);
    await openNotificationSettings(page);
    await expect(page.getByTestId('toggle-web-push')).toBeVisible();
    await expect(page.getByText(/never receives the sender/)).toBeVisible();
    await closeAll(page);
  });

  test('a closed tab is woken through the push service with a generic notification', async ({ playwright, browser, request }, info) => {
    test.skip(info.project.name !== 'firefox' || process.env.E2E_OFFLINE === '1', 'needs Firefox and Mozilla push (internet)');
    test.setTimeout(180_000);
    const deployment = await (await request.get('/v1/deployment-info')).json();
    test.skip(!deployment.push?.webPushKey, 'Web Push is not enabled on this deployment');
    const firefox = await playwright.firefox.launch({ firefoxUserPrefs: FIREFOX_PUSH });
    try {
      const context = await firefox.newContext({ ignoreHTTPSErrors: true, permissions: ['notifications'] });
      const page = await context.newPage();
      const recipient = await createUser(request, 'closedtab');
      const sender = await createUser(request, 'waker');
      await enroll(page, recipient);
      await openNotificationSettings(page);
      await page.getByTestId('toggle-web-push').click();
      await expect(page.getByTestId('toggle-web-push')).toBeChecked();

      // "Close" Convo: leave the app (socket gone) but keep the profile and its service worker.
      await page.goto('/logo.svg');
      const other = await newPage(browser);
      await enroll(other, sender);
      await startChat(other, recipient);
      await send(other, 'secret text that must not reach the push service');
      await expect.poll(() => shownNotifications(page), { timeout: 60_000 }).toEqual(['New message or call']);

      // Turning it off unsubscribes and unregisters: later mail produces no notification.
      await page.goto('/');
      await openNotificationSettings(page);
      await page.getByTestId('toggle-web-push').click();
      await expect(page.getByTestId('toggle-web-push')).not.toBeChecked();
      await page.goto('/logo.svg');
      await page.evaluate(async () => { for (const n of await (await navigator.serviceWorker.getRegistration('/'))?.getNotifications() ?? []) n.close(); });
      await send(other, 'second message');
      await page.waitForTimeout(8_000);
      expect(await shownNotifications(page)).toEqual([]);
      await closeAll(other);
    } finally {
      await firefox.close();
    }
  });
});
