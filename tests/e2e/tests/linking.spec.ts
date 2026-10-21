import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, openChat, send, signIn, startChat } from './support';

/**
 * Device linking (ID-02): a second browser joins an existing account only after a trusted device
 * approves it with matching codes; afterwards both devices receive new messages and see each
 * other's sent messages (own-device sync transcripts).
 */
test('link a second browser with code comparison, then fan-out reaches both devices', async ({ browser, request }) => {
  const anaUser = await createUser(request, 'ana');
  const danUser = await createUser(request, 'dan');
  const anaLaptop = await newPage(browser);
  const anaSecond = await newPage(browser);
  const dan = await newPage(browser);
  await enroll(anaLaptop, anaUser);
  await enroll(dan, danUser);

  // Second browser signs in to an account that already has a device → link screen with a code.
  await signIn(anaSecond, anaUser);
  const newDeviceCode = anaSecond.getByTestId('link-code');
  await expect(newDeviceCode).toBeVisible({ timeout: 45_000 });
  const code = (await newDeviceCode.textContent())!.trim();
  expect(code).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);

  // Trusted device sees the same code and approves.
  await anaLaptop.getByTestId('nav-settings').click();
  await anaLaptop.getByTestId('settings-devices').click();
  const pending = anaLaptop.getByTestId('link-request');
  await expect(pending).toBeVisible();
  await expect(pending.getByTestId('link-request-code')).toHaveText(code);
  await pending.getByRole('button', { name: 'Codes match — approve' }).click();

  // New browser finishes enrollment and both devices are listed.
  await expect(anaSecond.getByTestId('nav-settings')).toBeVisible({ timeout: 30_000 });
  await expect(anaLaptop.getByTestId('device-row')).toHaveCount(2);

  // Dan writes to Ana: delivered to both of Ana's devices.
  await startChat(dan, anaUser);
  await send(dan, 'hello both of your devices');
  await openChat(anaSecond, danUser.name);
  await expect(message(anaSecond, 'hello both of your devices')).toBeVisible();
  await openChat(anaLaptop, danUser.name);
  await expect(message(anaLaptop, 'hello both of your devices')).toBeVisible();

  // Ana answers from the new browser: Dan receives it and Ana's laptop mirrors it as sent.
  await send(anaSecond, 'answering from my second browser');
  await expect(message(dan, 'answering from my second browser')).toBeVisible();
  await expect(message(anaLaptop, 'answering from my second browser')).toBeVisible();

  // ID-02 security notice: the original device records the new link in Note to self.
  await anaLaptop.getByTestId('nav-chats').click();
  await anaLaptop.getByTestId('new-chat').click(); await anaLaptop.getByTestId('note-to-self').click();
  await expect(anaLaptop.getByTestId('security-notice')).toContainText('a new device was linked to your account — Web (#2)', { timeout: 20_000 });
  await closeAll(anaLaptop, anaSecond, dan);
});
