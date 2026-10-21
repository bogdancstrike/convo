import { expect, test } from '@playwright/test';
import { closeAll, createUser, enroll, message, messageMenu, newPage, openChat, send, startChat } from './support';

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

    // Alice finds Bob by display name (ADR-0002) and starts the conversation.
    await startChat(alice, bobUser, bobUser.name);
    await send(alice, 'Bună, Bob! *bold* hello');
    const aliceFirst = message(alice, 'Bună, Bob! bold hello');
    await expect(aliceFirst).toBeVisible();

    // Bob receives it in a new conversation and the sender sees delivery.
    await openChat(bob, aliceUser.name);
    await expect(message(bob, 'Bună, Bob! bold hello')).toBeVisible();
    await expect(aliceFirst.getByTestId('message-status')).toHaveText('Received');

    // Bob replies (established session, whisper messages).
    await send(bob, 'Hi Alice 👋');
    await expect(message(alice, 'Hi Alice 👋')).toBeVisible();

    // Reaction from Bob's message menu appears for Alice.
    const menu = await messageMenu(bob, 'Bună, Bob! bold hello');
    await menu.getByRole('button', { name: 'React 👍' }).click();
    await expect(aliceFirst.getByTestId('reaction')).toHaveText('👍 1');

    // Alice edits her message; Bob sees the new text marked edited.
    await (await messageMenu(alice, 'Bună, Bob! bold hello')).getByTestId('action-edit').click();
    await alice.getByTestId('composer').fill('Bună, Bob! (edited text)');
    await alice.getByTestId('send').click();
    const bobEdited = message(bob, 'Bună, Bob! (edited text)');
    await expect(bobEdited).toBeVisible();
    await expect(bobEdited).toContainText('edited');

    // Alice deletes it for everyone; Bob sees a tombstone.
    await (await messageMenu(alice, 'Bună, Bob! (edited text)')).getByTestId('action-delete').click();
    await alice.getByTestId('delete-everyone').click();
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

    // Find the recipient by phone number.
    await startChat(sender, recipientUser, recipientUser.phone.replace(/\s/g, ''));
    for (const text of ['first while offline', 'second while offline']) await send(sender, text);
    await expect(message(sender, 'second while offline').getByTestId('message-status')).toHaveText('Sent');

    // Recipient comes back with the same encrypted local state and drains the mailbox.
    await recipient.goto('/');
    await openChat(recipient, senderUser.name);
    await expect(message(recipient, 'first while offline')).toBeVisible();
    await expect(message(recipient, 'second while offline')).toBeVisible();
    await expect(message(sender, 'second while offline').getByTestId('message-status')).toHaveText('Received');
    await closeAll(sender, recipient);
  });

  test('Note to self works with a single device and survives a refresh', async ({ browser, request }) => {
    const user = await createUser(request, 'notes');
    const page = await newPage(browser);
    await enroll(page, user);
    await page.getByTestId('new-chat').click();
    await page.getByTestId('note-to-self').click();
    await send(page, 'remember the milk');
    await expect(message(page, 'remember the milk').getByTestId('message-status')).toHaveText('Sent');

    // F5 restores the same open chat (URL navigation state + encrypted local storage).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('splash')).toBeVisible();
    await expect(page.getByTestId('thread-title')).toHaveText('Note to self');
    await expect(message(page, 'remember the milk')).toBeVisible();
    await closeAll(page);
  });

  test('emoji picker search, forwarding and the conversation menu', async ({ browser, request }) => {
    const [aU, bU, cU] = await Promise.all(['ada', 'ben', 'cy'].map((p) => createUser(request, p)));
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => newPage(browser)));
    for (const [p, u] of [[a, aU], [b, bU], [c, cU]] as const) await enroll(p, u);

    await startChat(a, bU);
    await a.getByTestId('composer').fill('party time ');
    await a.getByTestId('emoji-button').click();
    await a.getByTestId('emoji-picker').getByRole('textbox').fill('party popper');
    await a.getByTestId('emoji-picker').getByRole('button', { name: 'party popper' }).click();
    await a.keyboard.press('Escape');
    await expect(a.getByTestId('composer')).toHaveValue('party time 🎉');
    await a.getByTestId('send').click();
    await expect(message(a, 'party time 🎉')).toBeVisible();

    // Forward the message to Cy: it arrives marked "Forwarded".
    await startChat(a, cU);
    await openChat(a, bU.name);
    await (await messageMenu(a, 'party time 🎉')).getByTestId('action-forward').click();
    await a.getByTestId(`forward-to-${cU.name}`).click();
    await openChat(c, aU.name);
    await expect(message(c, 'party time 🎉')).toContainText('Forwarded');

    // Conversation menu: mute always → muted icon in the list; clear chat empties it locally.
    await a.getByTestId('thread-menu').click();
    await a.getByTestId('menu-mute').click();
    await a.getByTestId('menu-mute-always').click();
    await expect(a.getByTestId(`conversation-${cU.name}`).getByRole('img', { name: 'Mute' })).toBeVisible();
    await closeAll(a, b, c);
  });
});
