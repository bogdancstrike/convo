import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, newPage, openChat, startChat, send } from './support';

/** Specs §30.4: scheduled send (device-owned, editable/cancellable) and quiet send. */
test('scheduled message goes out at its time; a cancelled one never does; quiet send still delivers', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const [aliceU, bobU] = await Promise.all(['sched', 'schedbob'].map((p) => createUser(request, p)));
  const [alice, bob] = await Promise.all([1, 2].map(() => newPage(browser)));
  try {
    await enroll(alice, aliceU); await enroll(bob, bobU);
    await startChat(alice, bobU, bobU.name);
    await send(alice, 'hello');
    await openChat(bob, aliceU.name);

    // Schedule two messages ~1 minute ahead, then cancel one.
    const due = new Date(Date.now() + 70_000);
    const local = new Date(due.getTime() - due.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    for (const text of ['scheduled hello', 'never sent']) {
      await alice.getByTestId('composer').fill(text);
      await alice.getByTestId('send').click({ button: 'right' });
      await alice.getByTestId('send-schedule').click();
      await alice.getByTestId('schedule-time').fill(local);
      await alice.getByTestId('schedule-save').click();
      await expect(alice.getByTestId('schedule-dialog')).toHaveCount(0);
      await expect(alice.getByTestId('composer')).toHaveValue('');
    }
    await expect(alice.getByTestId('scheduled-bar')).toContainText('2 scheduled');
    await alice.getByTestId('scheduled-bar').click();
    await alice.getByTestId('scheduled-item').filter({ hasText: 'never sent' }).getByTestId('scheduled-cancel').click();
    await expect(alice.getByTestId('scheduled-item')).toHaveCount(1);
    await alice.keyboard.press('Escape');
    await expect(bob.getByTestId('message-body').filter({ hasText: 'scheduled hello' })).toHaveCount(0);

    // Quiet send arrives like any message.
    await alice.getByTestId('composer').fill('quiet note');
    await alice.getByTestId('send').click({ button: 'right' });
    await alice.getByTestId('send-quiet').click();
    await expect(bob.getByTestId('message-body').filter({ hasText: 'quiet note' })).toBeVisible({ timeout: 20_000 });

    // The scheduled one is delivered at (or just after) its time; the cancelled one never.
    await expect(bob.getByTestId('message-body').filter({ hasText: 'scheduled hello' })).toBeVisible({ timeout: 150_000 });
    expect(Date.now()).toBeGreaterThanOrEqual(due.getTime() - 60_000);
    await expect(alice.getByTestId('scheduled-bar')).toHaveCount(0);
    await bob.waitForTimeout(3000);
    await expect(bob.getByTestId('message-body').filter({ hasText: 'never sent' })).toHaveCount(0);
  } finally { await closeAll(alice, bob); }
});
