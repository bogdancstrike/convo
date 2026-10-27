import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeServer, until, type TestDevice } from '../test/fakeServer';
import type { ChatMessage } from './model';

// Real clients (key generation, Signal and MLS) are slow under the full parallel run.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

/**
 * Communities: an announcement channel (the root) with linked groups, an onboarding package
 * (welcome, rules, checklist) and acknowledgement requests — between real clients.
 */
let server: FakeServer;
let ana: TestDevice;
let bob: TestDevice;
let community: Awaited<ReturnType<TestDevice['client']['createCommunity']>>;

const dto = (d: TestDevice) => ({ accountId: d.account.accountId, username: d.account.username, displayName: d.account.displayName });
async function see(d: TestDevice, conversationId: string, predicate: (m: ChatMessage) => boolean): Promise<ChatMessage> {
  await until(async () => (await d.client.messages(conversationId)).some(predicate));
  return (await d.client.messages(conversationId)).find(predicate)!;
}
const bobsView = async () => (await bob.client.communities()).find((c) => c.communityId === community.communityId)!;

beforeEach(async () => {
  server = new FakeServer();
  ana = await server.enroll('ana', 'Ana Pop');
  bob = await server.enroll('bob', 'Bob Ionescu');
  await ana.client.start(); await bob.client.start();
  await until(() => ana.connection === 'online' && bob.connection === 'online');
  await until(() => server.accounts.get(bob.account.accountId)!.devices.get(1)!.keyPackages.length > 0);
  community = await ana.client.createCommunity('Makers', 'People who build things');
  await ana.client.addGroupMembers(community.conversationId, [bob.account.accountId]);
  await until(async () => (await bob.client.communities()).length === 1);
});
afterEach(() => server.close(ana, bob));

describe('communities', () => {
  it('the creator owns it; members see its name and description', async () => {
    expect(community.role).toBe('owner');
    const view = await bobsView();
    expect(view.role).toBe('member');
    await until(async () => (await bobsView()).name === 'Makers');
    expect((await bobsView()).description).toBe('People who build things');
  });

  it('admins create groups inside it; members find discoverable ones and ask to join', async () => {
    const team = await ana.client.createCommunityGroup(community, { name: 'Team chat', memberIds: [], visibility: 'discoverable', delegation: true });
    const groups = await bob.client.communityGroups(await bobsView());
    const listed = groups.find((g) => g.conversationId === team.id)!;
    expect(listed).toMatchObject({ status: 'active', member: false, visibility: 'discoverable', delegation: true });
    await until(async () => (await bob.client.communityGroups(await bobsView())).find((g) => g.conversationId === team.id)?.name === 'Team chat');
    await bob.client.requestCommunityGroup(await bobsView(), listed.groupId);
    expect([...server.communities.values()][0]!.joinRequests).toEqual([`${listed.groupId}:${bob.account.accountId}`]);
  });

  it('private groups stay hidden from non-members', async () => {
    const secret = await ana.client.createCommunityGroup(community, { name: 'Board', memberIds: [], visibility: 'private', delegation: false });
    expect((await bob.client.communityGroups(await bobsView())).some((g) => g.conversationId === secret.id)).toBe(false);
  });

  it('members cannot create groups in it', async () => {
    await expect(bob.client.createCommunityGroup(await bobsView(), { name: 'Mine', memberIds: [], visibility: 'discoverable', delegation: false })).rejects.toThrow();
  });

  it('a group owned by someone else is proposed until its owner accepts', async () => {
    const bobs = await bob.client.createGroup('Bob’s group', [dto(ana)]);
    await until(() => !!ana.client.conversations().find((c) => c.id === bobs.id));
    await ana.client.linkGroupToCommunity(community, bobs.id, 'discoverable');
    const proposed = (await bob.client.communityGroups(await bobsView())).find((g) => g.conversationId === bobs.id)!;
    expect(proposed).toMatchObject({ status: 'proposed', canAccept: true });
    await bob.client.acceptCommunityLink(await bobsView(), proposed.groupId, true);
    expect((await bob.client.communityGroups(await bobsView())).find((g) => g.conversationId === bobs.id)!.status).toBe('active');
    await ana.client.unlinkCommunityGroup(community, proposed.groupId);
    expect((await bob.client.communityGroups(await bobsView())).some((g) => g.conversationId === bobs.id)).toBe(false);
  });

  it('community operations are listed for managers', async () => {
    expect(await ana.client.communityOperations(community)).toEqual([]);
    expect(await ana.client.retryCommunityOperations(community)).toBe(0);
  });
});

describe('onboarding', () => {
  it('new members see the welcome and rules, acknowledge them, and the reviewer learns it', async () => {
    await ana.client.saveOnboarding(community, { welcome: 'Hello makers!', rules: 'Be kind.', ackRequired: true, recommended: [],
      checklist: [{ id: 'intro', label: 'Introduce yourself', required: false }] });
    await until(async () => (await bob.client.onboarding(await bobsView()))?.pkg.welcome === 'Hello makers!');
    const view = (await bob.client.onboarding(await bobsView()))!;
    expect(view.pkg.rules).toMatchObject({ version: 1, text: 'Be kind.', ackRequired: true });
    expect(view.reviewer).toBe(false);
    await bob.client.acknowledgeRules(await bobsView());
    await until(async () => (await ana.client.onboarding(community))!.rulesAcknowledged.includes(bob.account.accountId));
  });

  it('changing the rules raises their version; unchanged rules keep it', async () => {
    const draft = { welcome: 'Hi', rules: 'Rule one.', ackRequired: true, recommended: [], checklist: [] };
    await ana.client.saveOnboarding(community, draft);
    await ana.client.saveOnboarding(community, { ...draft, welcome: 'Hi again' });
    expect((await ana.client.onboarding(community))!.pkg.rules!.version).toBe(1);
    await ana.client.saveOnboarding(community, { ...draft, rules: 'Rule one. Rule two.' });
    expect((await ana.client.onboarding(community))!.pkg.rules!.version).toBe(2);
  });

  it('checklist progress is private to the member', async () => {
    await ana.client.saveOnboarding(community, { welcome: 'Hi', rules: '', ackRequired: false, recommended: [], checklist: [{ id: 'intro', label: 'Introduce yourself', required: true }] });
    await until(async () => !!(await bob.client.onboarding(await bobsView())));
    await bob.client.setChecklistItem(await bobsView(), 'intro', true);
    expect((await bob.client.onboarding(await bobsView()))!.progress.items['intro']?.done).toBe(true);
    expect((await ana.client.onboarding(community))!.progress.items['intro']).toBeUndefined();
  });

  it('only community admins edit onboarding, and there must be rules to acknowledge', async () => {
    await expect(bob.client.saveOnboarding(await bobsView(), { welcome: 'x', rules: '', ackRequired: false, recommended: [], checklist: [] })).rejects.toThrow();
    await expect(bob.client.acknowledgeRules(await bobsView())).rejects.toThrow();
  });
});

describe('announcement acknowledgements', () => {
  it('members acknowledge, the publisher sees it, and an acknowledgement can be withdrawn', async () => {
    await ana.client.sendText(community.conversationId, 'New fire drill rules', undefined, undefined, { due: Date.now() + 86_400_000 });
    const request = await see(bob, community.conversationId, (m) => m.body === 'New fire drill rules' && !!m.ackRequest);
    await bob.client.acknowledge(request);
    await see(ana, community.conversationId, (m) => m.body === 'New fire drill rules' && !!m.acks?.[bob.account.accountId]);
    const mine = (await bob.client.message(community.conversationId, ana.account.accountId, request.id))!;
    expect(mine.myAck).toBeDefined();
    await bob.client.withdrawAcknowledgement(mine);
    await see(ana, community.conversationId, (m) => m.body === 'New fire drill rules' && !m.acks?.[bob.account.accountId]);
  });

  it('reviewer candidates are the community owners and admins', async () => {
    expect(await ana.client.ackReviewerCandidates(community.conversationId)).toEqual([ana.account.accountId]);
    await ana.client.changeGroupRole(community.conversationId, bob.account.accountId, 'admin');
    expect((await ana.client.ackReviewerCandidates(community.conversationId)).sort()).toEqual([ana.account.accountId, bob.account.accountId].sort());
  });

  it('a deadline after the expiry is refused', async () => {
    await expect(ana.client.sendText(community.conversationId, 'bad', undefined, undefined, { due: Date.now() + 2 * 86_400_000, expires: Date.now() + 86_400_000 }))
      .rejects.toThrow('invalid acknowledgement times');
  });
});
