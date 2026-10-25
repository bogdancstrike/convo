import { expect, test, type Page } from '@playwright/test';
/**
 * Web ↔ Android call interoperability (run by `android/run-call.sh`, not by the default suite).
 *
 * A browser user calls the Android user in `PK_USER`; the driver script accepts on the emulator.
 * Every 30 s for `MINUTES` (default 5) the browser's WebRTC stats must show audio arriving and
 * leaving, decoded Android audio with non-zero energy (the debug build's test tone), and — with
 * `VIDEO=1` — decoded Android video frames. `SHARE=1` additionally shares the browser's screen. The Android side logs the same counters (tag
 * ConvoCallStats). Passing means both parties joined, heard (and saw) each other, and the call
 * stayed connected for the whole period.
 */
import { createUser, enroll, newPage } from '../tests/support';

const MINUTES = Number(process.env.MINUTES ?? 5);

/** Sums inbound/outbound RTP counters over every peer connection the page created. */
async function media(page: Page) {
  return page.evaluate(async () => {
    const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.filter((pc) => pc.connectionState !== 'closed');
    const out = { inAudioBytes: 0, inAudioEnergy: 0, inVideoFrames: 0, inVideoWidth: 0, outAudioBytes: 0, outVideoBytes: 0 };
    for (const pc of pcs) {
      (await pc.getStats()).forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'audio') { out.inAudioBytes += s.bytesReceived ?? 0; out.inAudioEnergy += s.totalAudioEnergy ?? 0; }
        if (s.type === 'inbound-rtp' && s.kind === 'video') { out.inVideoFrames += s.framesDecoded ?? 0; out.inVideoWidth = Math.max(out.inVideoWidth, s.frameWidth ?? 0); }
        if (s.type === 'outbound-rtp' && s.kind === 'audio') out.outAudioBytes += s.bytesSent ?? 0;
        if (s.type === 'outbound-rtp' && s.kind === 'video') out.outVideoBytes += s.bytesSent ?? 0;
      });
    }
    return out;
  });
}

test('browser calls the Android user; media flows both ways for the whole call', async ({ browser, request }) => {
  test.setTimeout((MINUTES + 4) * 60_000);
  const me = await createUser(request, 'webcaller');
  const page = await newPage(browser);
  await page.addInitScript(() => {
    const pcs: RTCPeerConnection[] = []; (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs = pcs;
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native { constructor(...args: ConstructorParameters<typeof Native>) { super(...args); pcs.push(this); } } as typeof Native;
  });
  await enroll(page, me);
  await page.getByTestId('new-chat').click();
  await page.getByTestId('directory-search').fill(process.env.PK_USER!);
  await page.getByTestId(`directory-${process.env.PK_USER}`).click();
  await page.getByTestId('composer').fill('Calling you from the browser'); await page.getByTestId('composer').press('Enter');
  await page.waitForTimeout(3000);
  await page.getByTestId(process.env.VIDEO ? 'start-video-call' : 'start-voice-call').click();
  const screen = page.getByTestId('call-screen');
  await expect(screen).toHaveAttribute('data-phase', 'connected', { timeout: 60_000 });
  console.log('CONNECTED');
  await expect(screen).toHaveAttribute('data-encrypted', 'true', { timeout: 30_000 });
  console.log('ENCRYPTED');
  // SHARE=1: also present the browser's screen; the Android side should show it full width.
  if (process.env.SHARE) { await page.getByTestId('call-share-screen').click(); await expect(page.getByTestId('call-sharing')).toBeVisible({ timeout: 20_000 }); console.log('SHARING'); }
  let previous = await media(page); let heard = 0;
  for (let t = 30; t <= MINUTES * 60; t += 30) {
    await page.waitForTimeout(30_000);
    const now = await media(page);
    console.log(`T+${t}s phase=${await screen.getAttribute('data-phase')} ${JSON.stringify(now)}`);
    expect(await screen.getAttribute('data-phase')).toBe('connected');
    expect(now.inAudioBytes, 'audio from Android keeps arriving').toBeGreaterThan(previous.inAudioBytes);
    expect(now.outAudioBytes, 'audio to Android keeps leaving').toBeGreaterThan(previous.outAudioBytes);
    if (now.inAudioEnergy - previous.inAudioEnergy > 0.001) heard++;
    if (process.env.VIDEO) {
      expect(now.inVideoFrames, 'video from Android keeps decoding').toBeGreaterThan(previous.inVideoFrames);
      expect(now.outVideoBytes).toBeGreaterThan(previous.outVideoBytes);
    }
    previous = now;
  }
  console.log(`HEARD intervals=${heard}`);
  expect(heard, 'decrypted Android audio is audible (not silence)').toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/android/web-in-call.png' });
  await page.getByTestId('call-end').click();
  await expect(screen).toHaveAttribute('data-reason', 'ended');
  console.log('ENDED');
});
