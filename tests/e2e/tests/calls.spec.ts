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

    // Minimize (WhatsApp): chats stay usable, audio keeps playing, the bar returns to the call.
    await callee.getByTestId('call-minimize').click();
    await expect(callee.getByTestId('call-mini-bar')).toBeVisible();
    await expect(callee.getByTestId('remote-audio')).toHaveCount(1);
    await send(callee, 'typing during the call');
    await expect(caller.getByTestId('message-body').filter({ hasText: 'typing during the call' })).toBeAttached({ timeout: 20_000 });
    await callee.getByTestId('call-return').click();
    await expect(screen(callee)).toHaveAttribute('data-phase', 'connected');

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

test('group voice call: two members join, the caller sees both, leaving does not end it for others', async ({ browser, request }) => {
  test.setTimeout(150_000);
  const [ownerU, bobU, carolU] = await Promise.all(['gowner', 'gbob', 'gcarol'].map((p) => createUser(request, p)));
  const [owner, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const groupName = `Call group ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click();
    await owner.getByTestId('new-group').click();
    for (const u of [bobU, carolU]) {
      await owner.getByTestId('people-search').fill(u.username);
      await owner.getByTestId(`pick-${u.username}`).click();
    }
    await owner.getByTestId('group-next').click();
    await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click();
    await owner.getByTestId('create-group').click();
    await send(owner, 'call in a minute');
    await openChat(bob, groupName);
    await openChat(carol, groupName);

    await owner.getByTestId('start-voice-call').click();
    for (const page of [bob, carol]) {
      await expect(screen(page)).toHaveAttribute('data-phase', 'incoming', { timeout: 20_000 });
      await page.getByTestId('call-accept').click();
    }
    for (const page of [owner, bob, carol]) {
      await expect(screen(page)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
      await expect(screen(page)).toHaveAttribute('data-encrypted', 'true', { timeout: 30_000 });
      await expect(page.getByTestId('remote-audio')).toHaveCount(2, { timeout: 20_000 });
    }
    await expect(screen(owner)).toContainText('3 in call');

    // Carol leaves; the call continues for the others.
    await carol.getByTestId('call-end').click();
    await expect(owner.getByTestId('remote-audio')).toHaveCount(1, { timeout: 20_000 });
    await expect(screen(bob)).toHaveAttribute('data-phase', 'connected');
    // Someone left: the remaining participants switch to a new media key (one leader, same generation).
    for (const page of [owner, bob]) await expect(screen(page)).toHaveAttribute('data-key-generation', '1', { timeout: 20_000 });
    await expect(screen(bob)).toHaveAttribute('data-encrypted', 'true');
    await owner.getByTestId('call-end').click();
    await bob.getByTestId('call-end').click();
    await expect(screen(bob)).toHaveCount(0, { timeout: 10_000 });
  } finally { await closeAll(owner, bob, carol); }
});

test('a member removed from the group is dropped from its ongoing call and the key rotates', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const [ownerU, bobU, carolU] = await Promise.all(['rowner', 'rbob', 'rcarol'].map((p) => createUser(request, p)));
  const [owner, bob, carol] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU]] as const) await enroll(page, user);
    const groupName = `Rekey group ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click();
    await owner.getByTestId('new-group').click();
    for (const u of [bobU, carolU]) {
      await owner.getByTestId('people-search').fill(u.username);
      await owner.getByTestId(`pick-${u.username}`).click();
    }
    await owner.getByTestId('group-next').click();
    await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click();
    await owner.getByTestId('create-group').click();
    await send(owner, 'bob will call');
    await openChat(bob, groupName);
    await openChat(carol, groupName);

    // Bob calls, Carol answers; the owner declines and stays outside the call.
    await bob.getByTestId('start-voice-call').click();
    await expect(screen(carol)).toHaveAttribute('data-phase', 'incoming', { timeout: 20_000 });
    await carol.getByTestId('call-accept').click();
    await expect(screen(owner)).toHaveAttribute('data-phase', 'incoming', { timeout: 20_000 });
    await owner.getByTestId('call-decline').click();
    for (const page of [bob, carol]) {
      await expect(screen(page)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
      await expect(screen(page)).toHaveAttribute('data-encrypted', 'true', { timeout: 30_000 });
      await expect(screen(page)).toHaveAttribute('data-key-generation', '0');
    }

    // The owner removes Carol from the group: the server drops her device from the call and Bob
    // (now the only participant) rotates the key through the MLS group Carol is no longer in.
    await owner.getByTestId('thread-info').click();
    owner.once('dialog', (d) => void d.accept());
    await owner.getByTestId(`member-menu-${carolU.username}`).click();
    await owner.getByRole('menuitem', { name: 'Remove', exact: true }).click();
    await expect(owner.getByTestId(`member-${carolU.username}`)).toHaveCount(0);
    await expect(screen(carol)).toHaveAttribute('data-reason', 'removed', { timeout: 30_000 });
    await expect(screen(bob)).toHaveAttribute('data-key-generation', '1', { timeout: 30_000 });
    await expect(screen(bob)).toHaveAttribute('data-phase', 'connected');
    await bob.getByTestId('call-end').click();
  } finally { await closeAll(owner, bob, carol); }
});

test('if the other side drops without hanging up, the caller is told the connection was lost', async ({ browser, request }) => {
  const { caller, callee } = await pair(browser, request);
  try {
    await caller.getByTestId('start-voice-call').click();
    await callee.getByTestId('call-accept').click({ timeout: 30_000 });
    await expect(screen(caller)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
    // The callee's browser disappears (no encrypted "end" message is sent).
    await callee.context().close();
    await expect(screen(caller)).toHaveAttribute('data-reason', 'lost', { timeout: 60_000 });
    await expect(screen(caller)).toContainText('couldn’t stay connected');
  } finally { await closeAll(caller); }
});

test('screen sharing shows the presenter view with decrypted frames and stops cleanly', async ({ browser, request, browserName }) => {
  test.skip(browserName !== 'chromium', 'headless Firefox has no auto-accepted display capture');
  const { caller, callee } = await pair(browser, request);
  try {
    await caller.getByTestId('start-voice-call').click();
    await expect(screen(callee)).toHaveAttribute('data-phase', 'incoming', { timeout: 20_000 });
    await callee.getByTestId('call-accept').click();
    await expect(screen(caller)).toHaveAttribute('data-encrypted', 'true', { timeout: 30_000 });
    await caller.getByTestId('call-share-screen').click();
    await expect(caller.getByTestId('call-sharing')).toBeVisible({ timeout: 20_000 });
    await expect(caller.getByTestId('call-share-screen')).toHaveAttribute('aria-pressed', 'true');
    // The callee gets the presenter layout and decodes frames encrypted with the call key.
    const stage = callee.getByTestId('remote-screen');
    await expect(stage).toContainText('is presenting', { timeout: 20_000 });
    await expect.poll(() => stage.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(screen(callee)).toHaveAttribute('data-encrypted', 'true');
    await callee.screenshot({ path: test.info().outputPath('screen-share-callee.png') });
    await caller.getByTestId('call-share-screen').click();
    await expect(caller.getByTestId('call-sharing')).toHaveCount(0);
    await expect(stage).toHaveCount(0, { timeout: 20_000 });
    await caller.getByTestId('call-end').click();
  } finally { await closeAll(caller, callee); }
});

/** AC-CALL-07: a member call link joins the group's running call; non-members and revoked links get nothing. */
test('member call link joins the running group call with the current key; non-members and revoked links are refused', async ({ browser, request }) => {
  test.setTimeout(200_000);
  const [ownerU, bobU, carolU, daveU] = await Promise.all(['lowner', 'lbob', 'lcarol', 'ldave'].map((p) => createUser(request, p)));
  const [owner, bob, carol, dave] = await Promise.all([1, 2, 3, 4].map(() => newPage(browser)));
  try {
    for (const [page, user] of [[owner, ownerU], [bob, bobU], [carol, carolU], [dave, daveU]] as const) await enroll(page, user);
    const groupName = `Link group ${Date.now() % 10000}`;
    await owner.getByTestId('new-chat').click();
    await owner.getByTestId('new-group').click();
    for (const u of [bobU, carolU]) { await owner.getByTestId('people-search').fill(u.username); await owner.getByTestId(`pick-${u.username}`).click(); }
    await owner.getByTestId('group-next').click();
    await owner.getByTestId('group-name').fill(groupName);
    await owner.getByTestId('review-group').click();
    await owner.getByTestId('create-group').click();
    await send(owner, 'link call soon');
    await openChat(bob, groupName); await openChat(carol, groupName);

    // A member creates the link from group info; only its token appears, once.
    await owner.getByTestId('thread-info').click();
    await owner.getByTestId('call-link-create').click();
    const url = await owner.getByTestId('call-link').inputValue();
    expect(url).toMatch(/\/call\/[A-Za-z0-9_-]{43}$/);
    expect(url).not.toContain('#'); // a real path, so Android App Links can match it
    const hash = `#${new URL(url).pathname}`; // the app route the path is rewritten to
    await owner.getByTestId('close-info').click();

    // Owner rings, Bob answers, Carol declines (her device still keeps the call's key).
    await owner.getByTestId('start-voice-call').click();
    await expect(screen(bob)).toHaveAttribute('data-phase', 'incoming', { timeout: 20_000 });
    await bob.getByTestId('call-accept').click();
    await expect(screen(carol)).toHaveAttribute('data-phase', 'incoming', { timeout: 20_000 });
    await carol.getByTestId('call-decline').click();
    await expect(screen(owner)).toHaveAttribute('data-encrypted', 'true', { timeout: 30_000 });

    // Carol opens the shared link itself (full page load of /call/<token>): connected and decrypting.
    await carol.goto(url);
    await expect(screen(carol)).toHaveAttribute('data-phase', 'connected', { timeout: 30_000 });
    await expect(screen(carol)).toHaveAttribute('data-encrypted', 'true', { timeout: 30_000 });
    await expect(screen(owner)).toContainText('3 in call', { timeout: 20_000 });

    // She leaves: the key rotates; rejoining by link uses the rotated key she received.
    await carol.getByTestId('call-end').click();
    for (const page of [owner, bob]) await expect(screen(page)).toHaveAttribute('data-key-generation', '1', { timeout: 20_000 });
    await expect(screen(carol)).toHaveCount(0, { timeout: 10_000 });
    await carol.evaluate((h) => { window.location.hash = h; }, hash);
    await expect(screen(carol)).toHaveAttribute('data-key-generation', '1', { timeout: 30_000 });
    await expect(screen(carol)).toHaveAttribute('data-encrypted', 'true', { timeout: 30_000 });
    await carol.getByTestId('call-end').click();

    // Dave is not a member: the link reveals nothing and joins nothing.
    await dave.evaluate((h) => { window.location.hash = h; }, hash);
    await expect(screen(dave)).toHaveAttribute('data-reason', 'linkUnavailable', { timeout: 20_000 });

    // Revoked by its creator: members can no longer use it either.
    await owner.getByTestId('call-end').click();
    await bob.getByTestId('call-end').click();
    await owner.getByTestId('thread-info').click();
    await owner.getByTestId('call-link-create').click();
    const second = await owner.getByTestId('call-link').inputValue();
    await owner.getByTestId('call-link-revoke').click();
    await expect(owner.getByTestId('call-link-section')).toContainText('revoked');
    await expect(screen(carol)).toHaveCount(0, { timeout: 10_000 });
    await carol.evaluate((h) => { window.location.hash = h; }, `#${new URL(second).pathname}`);
    await expect(screen(carol)).toHaveAttribute('data-reason', 'linkUnavailable', { timeout: 20_000 });
  } finally { await closeAll(owner, bob, carol, dave); }
});
