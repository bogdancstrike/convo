import { expect, test } from '@playwright/test';
import { createUser, enroll, newPage, send } from '../tests/support';

/**
 * Member call link opened on Android (run by `run-call-link.sh`): the browser creates a group with
 * the Android user, shares a call link and starts the call; Android declines the ring, then opens
 * the link and must join the running call with end-to-end encryption.
 */
test('Android joins a running group call from a member call link', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const me = await createUser(request, 'linkhost');
  const page = await newPage(browser);
  await enroll(page, me);
  const groupName = `Android link ${Date.now() % 10000}`;
  await page.getByTestId('new-chat').click();
  await page.getByTestId('new-group').click();
  await page.getByTestId('people-search').fill(process.env.PK_USER!);
  await page.getByTestId(`pick-${process.env.PK_USER}`).click();
  await page.getByTestId('group-next').click();
  await page.getByTestId('group-name').fill(groupName);
  await page.getByTestId('review-group').click();
  await page.getByTestId('create-group').click();
  await send(page, 'Group call with a link');
  await page.getByTestId('thread-info').click();
  await page.getByTestId('call-link-create').click();
  const url = await page.getByTestId('call-link').inputValue();
  await page.getByTestId('close-info').click();
  await page.waitForTimeout(5000);
  await page.getByTestId('start-voice-call').click();
  console.log(`CALL LINK ${url.slice(url.indexOf('#'))}`);
  const screen = page.getByTestId('call-screen');
  await expect(screen).toHaveAttribute('data-phase', 'connected', { timeout: 120_000 });
  await expect(screen).toHaveAttribute('data-encrypted', 'true', { timeout: 30_000 });
  console.log('ANDROID JOINED');
  await page.waitForTimeout(10_000);
  await expect(screen).toHaveAttribute('data-phase', 'connected');
  await page.getByTestId('call-end').click();
});
