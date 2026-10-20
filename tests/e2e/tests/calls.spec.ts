import { expect, test, type Page } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, send, startChat } from './support';

/**
 * Calls: LiveKit SFU + coturn from Compose; ringing over E2EE messages; media frames end-to-end
 * encrypted with the key from the ring. Browsers use fake microphone/camera devices.
 */
async function pair(browser: Parameters<typeof newPage>[0], request: Parameters<typeof createUser>[0]) {
  const callerUser = await createUser(request, 'caller');
  const calleeUser = await createUser(request, 'callee');
  const caller = await newPage(browser);
  const callee = await newPage(browser);
  await enroll(caller, callerUser);
  await enroll(callee, calleeUser);
  await startChat(caller, calleeUser, calleeUser.name);
  await send(caller, 'Can I call you?');
  await openChat(callee, callerUser.name);
  return { caller, callee, callerUser, calleeUser };
}

const screen = (page: Page) => page.getByTestId('call-screen');

test('voice call rings, connects with end-to-end encryption and ends for both sides', async ({ browser, request }) => {
  const { caller, callee, callerUser } = await pair(browser, request);
  try {
    await caller.getByTestId('start-voice-call').click();
    await expect(screen(caller)).toHaveAttribute('data-phase', 'outgoing');
    await expect(screen(callee)).toHaveAttribute('data-phase', 'incoming', { timeout: 20_000 });
    await expect(screen(callee)).toContainText(callerUser.name);
    await expect(screen(callee).getByTestId('call-status')).toHaveText('Incoming voice call…');
    await callee.getByTestId('call-accept').click();
    await expect(screen(callee)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
    await expect(screen(caller)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
    // LiveKit confirms the peer's frames are encrypted with the key from the E2EE ring.
    await expect(screen(caller)).toHaveAttribute('data-encrypted', 'true', { timeout: 20_000 });
    await expect(screen(callee)).toHaveAttribute('data-encrypted', 'true', { timeout: 20_000 });
    await expect(screen(caller).getByTestId('call-e2ee')).toHaveText(/End-to-end encrypted/);
    // Remote audio arrives (decrypted by the frame cryptor) on both sides.
    await expect(caller.getByTestId('remote-audio')).toHaveCount(1);
    await expect.poll(() => callee.getByTestId('remote-audio').evaluate((a: HTMLAudioElement) => !!a.srcObject && (a.srcObject as MediaStream).getAudioTracks().length), { timeout: 20_000 }).toBe(1);
    await caller.getByTestId('call-mute').click();
    await expect(caller.getByTestId('call-mute')).toHaveAttribute('aria-pressed', 'true');

    await callee.getByTestId('call-end').click();
    await expect(screen(callee)).toHaveAttribute('data-reason', 'ended');
    await expect(screen(caller)).toHaveAttribute('data-reason', 'ended', { timeout: 20_000 });
    await expect(screen(caller)).toHaveCount(0, { timeout: 10_000 });

    await caller.getByTestId('nav-calls').click();
    await expect(caller.getByTestId('call-log-entry').first()).toHaveAttribute('data-status', 'ended');
  } finally { await closeAll(caller, callee); }
});

test('a declined video call tells the caller and is logged on both devices', async ({ browser, request }) => {
  const { caller, callee } = await pair(browser, request);
  try {
    await caller.getByTestId('start-video-call').click();
    await expect(screen(callee)).toHaveAttribute('data-phase', 'incoming', { timeout: 20_000 });
    await expect(screen(callee).getByTestId('call-status')).toHaveText('Incoming video call…');
    await callee.getByTestId('call-decline').click();
    await expect(screen(caller)).toHaveAttribute('data-reason', 'declined', { timeout: 20_000 });
    await callee.getByTestId('nav-calls').click();
    await expect(callee.getByTestId('call-log-entry').first()).toHaveAttribute('data-status', 'declined');
    await caller.getByTestId('nav-calls').click();
    await expect(caller.getByTestId('call-log-entry').first()).toHaveAttribute('data-status', 'declined');
  } finally { await closeAll(caller, callee); }
});
