import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, until, type TestDevice } from '../test/fakeServer';

// Real clients (key generation, Signal and MLS) are slow under the full parallel run.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import type { ChatMessage } from './model';

/**
 * Direct-chat features between two real clients over the in-memory server: what one side does
 * must be what the other side sees.
 */
let server: FakeServer;
let ana: TestDevice;
let bob: TestDevice;
let anaId: string;
let bobId: string;

const all = (d: TestDevice, conversationId: string) => d.client.messages(conversationId);
const find = async (d: TestDevice, conversationId: string, predicate: (m: ChatMessage) => boolean) => (await all(d, conversationId)).find(predicate);
/** Waits until `d` has a message in `conversationId` satisfying `predicate`, and returns it. */
async function see(d: TestDevice, conversationId: string, predicate: (m: ChatMessage) => boolean): Promise<ChatMessage> {
  await until(async () => !!(await find(d, conversationId, predicate)));
  return (await find(d, conversationId, predicate))!;
}
/** Ana sends `body`; returns Ana's copy and Bob's copy once it has arrived. */
async function exchange(body: string): Promise<{ mine: ChatMessage; theirs: ChatMessage }> {
  await ana.client.sendText(bobId, body);
  const theirs = await see(bob, anaId, (m) => m.body === body);
  const mine = (await find(ana, bobId, (m) => m.body === body))!;
  return { mine, theirs };
}

beforeEach(async () => {
  server = new FakeServer();
  ana = await server.enroll('ana', 'Ana Pop');
  bob = await server.enroll('bob', 'Bob Ionescu');
  anaId = ana.account.accountId; bobId = bob.account.accountId;
  await ana.client.start(); await bob.client.start();
  await until(() => ana.connection === 'online' && bob.connection === 'online');
  await ana.client.openConversation({ accountId: bobId, username: 'bob', displayName: 'Bob Ionescu' });
  await exchange('hello');
  await bob.client.acceptRequest(anaId);
});
afterEach(() => server.close(ana, bob));

describe('editing and deleting', () => {
  it('an edit replaces the text on both sides and keeps the revision', async () => {
    const { mine } = await exchange('Meeting at 10');
    expect(ana.client.canEdit(mine)).toBe(true);
    await ana.client.edit(mine, 'Meeting at 11');
    const theirs = await see(bob, anaId, (m) => m.body === 'Meeting at 11');
    expect(theirs.editedAt).toBeDefined();
    expect((await find(ana, bobId, (m) => m.id === mine.id))?.body).toBe('Meeting at 11');
  });

  it('only own messages can be edited', async () => {
    await bob.client.sendText(anaId, 'from bob');
    const theirs = await see(ana, bobId, (m) => m.body === 'from bob');
    expect(ana.client.canEdit(theirs)).toBe(false);
  });

  it('delete for everyone removes the text on both sides', async () => {
    const { mine } = await exchange('oops');
    await ana.client.deleteForEveryone(mine);
    await see(bob, anaId, (m) => m.id === mine.id && m.deleted === true);
    const own = await find(ana, bobId, (m) => m.id === mine.id);
    expect(own?.deleted).toBe(true);
    expect(own?.body ?? '').toBe('');
  });

  it('delete for me only affects this device', async () => {
    const { mine } = await exchange('keep for bob');
    await ana.client.deleteLocally(mine);
    expect(await find(ana, bobId, (m) => m.id === mine.id)).toBeUndefined();
    expect(await find(bob, anaId, (m) => m.id === mine.id)).toBeDefined();
  });
});

describe('reactions, stars, pins and forwarding', () => {
  it('a reaction arrives, and reacting again with the same emoji removes it', async () => {
    const { theirs } = await exchange('nice photo');
    await bob.client.react(theirs, '👍');
    await see(ana, bobId, (m) => m.id === theirs.id && (m.reactions['👍'] ?? []).includes(bobId));
    const reacted = (await find(bob, anaId, (m) => m.id === theirs.id))!;
    await bob.client.react(reacted, '👍');
    await see(ana, bobId, (m) => m.id === theirs.id && !(m.reactions['👍'] ?? []).includes(bobId));
  });

  it('reacting from a stale copy keeps reactions received since', async () => {
    const { mine, theirs } = await exchange('vote with emoji');
    await bob.client.react(theirs, '🎉');
    await see(ana, bobId, (m) => m.id === mine.id && (m.reactions['🎉'] ?? []).includes(bobId));
    // `mine` is Ana's copy from before Bob's reaction, as a UI might still hold it.
    await ana.client.react(mine, '👍');
    const after = (await find(ana, bobId, (m) => m.id === mine.id))!;
    expect(after.reactions['🎉']).toEqual([bobId]);
    expect(after.reactions['👍']).toEqual([anaId]);
  });

  it('starring is local', async () => {
    const { mine } = await exchange('remember this');
    await ana.client.setStarred(mine, true);
    expect((await find(ana, bobId, (m) => m.id === mine.id))?.starred).toBe(true);
    expect((await find(bob, anaId, (m) => m.id === mine.id))?.starred).toBeFalsy();
  });

  it('forwarding sends a marked copy to another chat', async () => {
    const { theirs } = await exchange('pass it on');
    const notes = await bob.client.openConversation({ accountId: bobId, username: 'bob' });
    await bob.client.forward(theirs, notes.id);
    const copy = await see(bob, notes.id, (m) => m.body === 'pass it on');
    expect(copy.forwarded).toBe(true);
  });

  it('pinning a message shows on both sides', async () => {
    const { mine } = await exchange('pin me');
    expect(await ana.client.canPin(bobId)).toBe(true);
    await ana.client.setPinned(mine, true);
    await until(() => (bob.client.conversations().find((c) => c.id === anaId)?.pinnedMessages ?? []).length > 0);
  });
});

describe('polls and events', () => {
  it('a poll collects votes from the other side and can be closed by its author', async () => {
    await ana.client.sendPoll(bobId, 'Lunch?', ['Pizza', 'Sushi'], false);
    const poll = await see(bob, anaId, (m) => m.poll?.question === 'Lunch?');
    await bob.client.votePoll(poll, [poll.poll!.options[1]!.id]);
    const counted = await see(ana, bobId, (m) => !!m.poll && Object.keys(m.poll.votes).includes(bobId));
    expect(counted.poll!.votes[bobId]!.optionIds).toEqual([poll.poll!.options[1]!.id]);
    expect(await ana.client.canClosePoll(counted, anaId)).toBe(true);
    expect(await ana.client.canClosePoll(counted, bobId)).toBe(false);
    await ana.client.closePoll(counted);
    await see(bob, anaId, (m) => m.id === poll.id && !!m.poll?.closed);
  });

  it('a quiz reveals the explanation and keeps the first answer', async () => {
    await ana.client.sendQuiz(bobId, '2+2?', ['3', '4'], 1, 'Arithmetic.');
    const quiz = await see(bob, anaId, (m) => m.poll?.question === '2+2?');
    expect(quiz.poll!.correctOptionId).toBe(quiz.poll!.options[1]!.id);
    await bob.client.votePoll(quiz, [quiz.poll!.options[0]!.id]);
    await see(ana, bobId, (m) => !!m.poll?.votes[bobId]);
  });

  it('an event takes RSVPs', async () => {
    await ana.client.createEvent(bobId, { title: 'Standup', start: Date.now() + 3_600_000, location: 'Room 1' });
    const event = await see(bob, anaId, (m) => m.event?.title === 'Standup');
    expect(event.event!.location).toBe('Room 1');
    await bob.client.rsvp(event, 'going');
    await see(ana, bobId, (m) => m.event?.rsvps[bobId]?.response === 'going');
  });
});

describe('disappearing messages', () => {
  it('a timer applies to both sides and expired messages are swept', async () => {
    await ana.client.setDisappearing(bobId, 86_400);
    await until(() => bob.client.conversations().find((c) => c.id === anaId)?.expireSeconds === 86_400);
    const { mine } = await exchange('gone soon');
    expect(mine.expireTimer).toBe(86_400);
    await ana.client.sweepExpired(Date.now() + 86_401_000);
    expect(await find(ana, bobId, (m) => m.id === mine.id)).toBeUndefined();
  });
});

describe('typing, blocking and requests', () => {
  it('typing indicators reach the other side when both allow them', async () => {
    await ana.client.updateSettings({ typingIndicators: true });
    await bob.client.updateSettings({ typingIndicators: true });
    let typing = false;
    bob.client.on('typing', (t) => { if ((t as { conversationId: string }).conversationId === anaId) typing = true; });
    await ana.client.sendTyping(bobId, 'started');
    await until(() => typing);
  });

  it('a blocked contact’s messages are not shown', async () => {
    await bob.client.setBlocked(anaId, true);
    expect(bob.client.isBlocked(anaId)).toBe(true);
    await ana.client.sendText(bobId, 'can you hear me?');
    await new Promise((r) => setTimeout(r, 300));
    expect(await find(bob, anaId, (m) => m.body === 'can you hear me?')).toBeUndefined();
    await bob.client.setBlocked(anaId, false);
    expect(bob.client.isBlocked(anaId)).toBe(false);
  });

  it('a new contact arrives as a message request until accepted', async () => {
    const cara = await server.enroll('cara');
    await cara.client.start();
    await until(() => cara.connection === 'online');
    await cara.client.sendText(bobId, 'hi, I am Cara');
    await see(bob, cara.account.accountId, (m) => m.body === 'hi, I am Cara');
    expect(bob.client.conversations().find((c) => c.id === cara.account.accountId)?.request).toBe(true);
    await bob.client.acceptRequest(cara.account.accountId);
    expect(bob.client.conversations().find((c) => c.id === cara.account.accountId)?.request).toBeFalsy();
    cara.client.stop();
  });
});

describe('conversation housekeeping', () => {
  it('clear removes messages but keeps the chat; delete removes the chat', async () => {
    await exchange('to be cleared');
    await bob.client.clearConversation(anaId);
    expect(await all(bob, anaId)).toHaveLength(0);
    expect(bob.client.conversations().some((c) => c.id === anaId)).toBe(true);
    await bob.client.deleteConversation(anaId);
    expect(bob.client.conversations().some((c) => c.id === anaId)).toBe(false);
  });

  it('mute, snooze, archive and pin are stored per chat', async () => {
    const until1 = Date.now() + 3_600_000;
    await bob.client.setMute(anaId, until1);
    await bob.client.setSnooze(anaId, until1);
    await bob.client.updateConversation(anaId, { archived: true, pinned: true });
    const chat = bob.client.conversations().find((c) => c.id === anaId)!;
    expect(chat).toMatchObject({ archived: true, pinned: true });
    expect(chat.snooze?.until).toBe(until1);
  });

  it('search finds messages by text', async () => {
    await exchange('the blue elephant');
    expect((await bob.client.searchMessages('elephant')).map((m) => m.body)).toEqual(['the blue elephant']);
    expect(await bob.client.searchMessages('giraffe')).toEqual([]);
  });

  it('a reading anchor is remembered per chat', async () => {
    await bob.client.setReadingAnchor(anaId, { key: 'm1', offset: 12 });
    expect(await bob.client.readingAnchor(anaId)).toEqual({ key: 'm1', offset: 12 });
    await bob.client.setReadingAnchor(anaId, null);
    expect(await bob.client.readingAnchor(anaId)).toBeUndefined();
  });

  it('folders are saved and read back', async () => {
    await bob.client.saveFolders([{ id: 'f1', name: 'Work', include: [anaId], exclude: [] } as never]);
    expect((await bob.client.folders()).map((f) => f.name)).toEqual(['Work']);
  });
});

describe('scheduled messages', () => {
  it('are kept locally, editable and cancellable, and sent when due', async () => {
    const later = Date.now() + 3_600_000;
    const s1 = await ana.client.scheduleMessage(bobId, 'see you tomorrow', later);
    const s2 = await ana.client.scheduleMessage(bobId, 'never mind', later);
    expect((await ana.client.scheduledMessages(bobId)).map((s) => s.body).sort()).toEqual(['never mind', 'see you tomorrow']);
    await ana.client.cancelScheduled(s2.id);
    await expect(ana.client.editScheduled(s1.id, { dueAt: Date.now() - 1 })).rejects.toThrow();
    await ana.client.editScheduled(s1.id, { body: 'see you soon', dueAt: Date.now() + 50 });
    await new Promise((r) => setTimeout(r, 80));
    await ana.client.sendDueScheduled();
    await see(bob, anaId, (m) => m.body === 'see you soon');
    expect(await ana.client.scheduledMessages(bobId)).toEqual([]);
  });
});

describe('note to self and stickers', () => {
  it('note to self keeps messages on this account only', async () => {
    const notes = await ana.client.openConversation({ accountId: anaId, username: 'ana' });
    await ana.client.sendText(notes.id, 'buy milk');
    await see(ana, notes.id, (m) => m.body === 'buy milk');
    expect(await all(bob, anaId).then((ms) => ms.some((m) => m.body === 'buy milk'))).toBe(false);
  });

  it('a bundled sticker arrives as a sticker', async () => {
    await ana.client.sendSticker(bobId, 'basics', 'thumbs-up');
    await see(bob, anaId, (m) => (m as unknown as { sticker?: { id: string } }).sticker?.id === 'thumbs-up');
  });
});

describe('profiles', () => {
  it('a status update reaches contacts', async () => {
    await ana.client.updateProfile({ status: 'On holiday' });
    await until(() => bob.client.profiles().get(anaId)?.status === 'On holiday');
  });
});
