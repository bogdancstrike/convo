import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, newPage, send, startChat } from './support';

/**
 * Secure walking slice (M1): two browser-primary accounts register, find each other in the
 * directory and exchange end-to-end encrypted messages through the real backend.
 */
test.describe('direct encrypted messaging', () => {
  test('register, chat both ways, receipts, reactions, edits and deletes', async ({ browser, request }) => {
    const aliceUser = await createUser(request, 'alice');
    const bobUser = await createUser(request, 'bob');
    const alice = await newPage(browser);
    const bob = await newPage(browser);
    await enroll(alice, aliceUser);
    await enroll(bob, bobUser);

    // Alice starts the conversation (X3DH session from claimed prekeys).
    await startChat(alice, bobUser.username);
    await send(alice, 'Bună, Bob! *bold* hello');
    const aliceFirst = message(alice, 'Bună, Bob! bold hello');
    await expect(aliceFirst).toBeVisible();

    // Bob receives it in a new conversation and the sender sees delivery.
    await bob.getByTestId(`conversation-${aliceUser.username}`).click();
    await expect(message(bob, 'Bună, Bob! bold hello')).toBeVisible();
    await expect(aliceFirst.getByTestId('message-status')).toHaveText('Delivered');

    // Bob replies (established session, whisper messages).
    await send(bob, 'Hi Alice 👋');
    await expect(message(alice, 'Hi Alice 👋')).toBeVisible();

    // Reaction from Bob appears for Alice.
    const bobView = message(bob, 'Bună, Bob! bold hello');
    await bobView.hover();
    await bobView.getByRole('button', { name: 'React', exact: true }).click();
    await bobView.getByRole('button', { name: 'React 👍' }).click();
    await expect(aliceFirst.getByTestId('reaction')).toHaveText('👍 1');

    // Alice edits her message; Bob sees the new text marked edited.
    await aliceFirst.hover();
    await aliceFirst.getByRole('button', { name: 'Edit' }).click();
    await alice.getByTestId('composer').fill('Bună, Bob! (edited text)');
    await alice.getByTestId('send').click();
    const bobEdited = message(bob, 'Bună, Bob! (edited text)');
    await expect(bobEdited).toBeVisible();
    await expect(bobEdited).toContainText('edited');

    // Alice deletes it for everyone; Bob sees a tombstone.
    const aliceEdited = message(alice, 'Bună, Bob! (edited text)');
    alice.once('dialog', (d) => void d.accept());
    await aliceEdited.hover();
    await aliceEdited.getByRole('button', { name: 'Delete for everyone' }).click();
    await expect(bob.getByText('This message was deleted')).toBeVisible();
    await closeAll(alice, bob);
  });

  test('messages sent while the recipient is offline are delivered on reconnect', async ({ browser, request }) => {
    const senderUser = await createUser(request, 'sender');
    const recipientUser = await createUser(request, 'recipient');
    const sender = await newPage(browser);
    const recipient = await newPage(browser);
    await enroll(sender, senderUser);
    await enroll(recipient, recipientUser);

    // Recipient goes away (app closed, socket gone); the mailbox must hold the ciphertext.
    await recipient.goto('about:blank');

    await startChat(sender, recipientUser.username);
    for (const text of ['first while offline', 'second while offline']) await send(sender, text);
    await expect(message(sender, 'second while offline').getByTestId('message-status')).toHaveText('Sent');

    // Recipient comes back with the same encrypted local state and drains the mailbox.
    const back = recipient;
    await back.goto('/');
    await back.getByTestId(`conversation-${senderUser.username}`).click();
    await expect(message(back, 'first while offline')).toBeVisible();
    await expect(message(back, 'second while offline')).toBeVisible();
    await expect(message(sender, 'second while offline').getByTestId('message-status')).toHaveText('Delivered');
    await closeAll(sender, back);
  });

  test('Note to self works with a single device', async ({ browser, request }) => {
    const user = await createUser(request, 'notes');
    const page = await newPage(browser);
    await enroll(page, user);
    await page.getByRole('button', { name: 'Note to self' }).first().click();
    await send(page, 'remember the milk');
    await expect(message(page, 'remember the milk').getByTestId('message-status')).toHaveText('Sent');
    await closeAll(page);
  });
});
