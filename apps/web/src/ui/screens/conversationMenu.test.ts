// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import type { Conversation } from '../../core/model';

const { openSnooze } = vi.hoisted(() => ({ openSnooze: vi.fn() }));
vi.mock('./SnoozeDialog', () => ({ openSnooze }));
import { conversationMenu } from './conversationMenu';

const t = (key: string) => key;
const client = {
  setMute: vi.fn(async () => undefined), setSnooze: vi.fn(async () => undefined), updateConversation: vi.fn(async () => undefined),
  setBlocked: vi.fn(async () => undefined), leaveGroup: vi.fn(async () => undefined), clearConversation: vi.fn(async () => undefined),
  deleteConversation: vi.fn(async () => undefined),
};
const base: Conversation = { id: 'c1', title: 'Ana', kind: 'direct', pinned: false, muted: false, archived: false, unread: 0, lastActivity: 1, preview: '' };
const menu = (c: Partial<Conversation>, lock?: { locked: boolean; available: boolean; toggle: () => void }) => {
  const handlers = { info: vi.fn(), search: vi.fn(), close: vi.fn() };
  const items = conversationMenu(client as never, { ...base, ...c }, t as never, handlers.info, handlers.search, handlers.close, lock);
  const find = (label: string) => items.find((i) => i.label === label);
  return { items, find, labels: items.map((i) => i.label), handlers };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('confirm', vi.fn(() => true)); vi.stubGlobal('alert', vi.fn()); });

describe('conversation menu', () => {
  it('direct chats offer contact info and blocking, never leaving', () => {
    const { labels } = menu({});
    expect(labels).toContain('header.contactInfo'); expect(labels).toContain('block.block'); expect(labels).not.toContain('group.leave');
  });

  it('groups offer group info, mentions-only and leaving; channels say channel', () => {
    expect(menu({ kind: 'group' }).labels).toEqual(expect.arrayContaining(['header.groupInfo', 'notify.mentionsOnly', 'group.leave']));
    expect(menu({ kind: 'group', adminOnly: true }).labels).toContain('group.leaveChannel');
    expect(menu({ kind: 'group', left: true }).labels).not.toContain('group.leave');
    expect(menu({ kind: 'group', notify: 'mentions' }).labels).toContain('notify.allMessages');
  });

  it('mute offers durations, and a muted chat offers unmute', () => {
    const { find } = menu({});
    const mute = find('header.mute')!;
    expect(mute.children!.map((c) => c.label)).toEqual(['header.mute8h', 'header.mute1w', 'header.muteAlways']);
    mute.children![2]!.onSelect!();
    expect(client.setMute).toHaveBeenCalledWith('c1', Infinity);
    menu({ muted: true }).find('header.unmuteNow')!.onSelect!();
    expect(client.setMute).toHaveBeenLastCalledWith('c1', null);
  });

  it('snooze opens the dialog, or ends an active snooze', () => {
    menu({}).find('snooze.menu')!.onSelect!();
    expect(openSnooze).toHaveBeenCalledWith('c1');
    const snoozed = menu({ snooze: { until: Date.now() + 3_600_000, zone: 'UTC' } as never });
    snoozed.items.find((i) => i.testId === 'menu-snooze-end')!.onSelect!();
    expect(client.setSnooze).toHaveBeenCalledWith('c1', null);
  });

  it('pin, archive and notify toggles patch the conversation', () => {
    menu({}).find('header.pin')!.onSelect!();
    expect(client.updateConversation).toHaveBeenLastCalledWith('c1', { pinned: true });
    menu({ archived: true }).find('header.unarchive')!.onSelect!();
    expect(client.updateConversation).toHaveBeenLastCalledWith('c1', { archived: false });
    menu({ kind: 'group' }).find('notify.mentionsOnly')!.onSelect!();
    expect(client.updateConversation).toHaveBeenLastCalledWith('c1', { notify: 'mentions' });
  });

  it('the lock entry appears with a passkey, and always for a locked chat', () => {
    const toggle = vi.fn();
    expect(menu({}, { locked: false, available: false, toggle }).labels).not.toContain('lock.enable');
    menu({}, { locked: false, available: true, toggle }).find('lock.enable')!.onSelect!();
    expect(toggle).toHaveBeenCalled();
    expect(menu({}, { locked: true, available: false, toggle }).labels).toContain('lock.disable');
  });

  it('blocking asks first; unblocking does not', async () => {
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    menu({}).find('block.block')!.onSelect!(); await flush();
    expect(client.setBlocked).not.toHaveBeenCalled();
    menu({}).find('block.block')!.onSelect!(); await flush();
    expect(client.setBlocked).toHaveBeenCalledWith('c1', true);
    menu({ blocked: true }).find('block.unblock')!.onSelect!();
    expect(client.setBlocked).toHaveBeenLastCalledWith('c1', false);
  });

  it('a last owner leaving is told to hand over first', async () => {
    client.leaveGroup.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN_ROLE', 'last owner'));
    menu({ kind: 'group' }).find('group.leave')!.onSelect!(); await flush(); await flush();
    expect(window.alert).toHaveBeenCalledWith('group.leaveOwner');
    client.leaveGroup.mockRejectedValueOnce(new Error('network'));
    menu({ kind: 'group' }).find('group.leave')!.onSelect!(); await flush(); await flush();
    expect(window.alert).toHaveBeenLastCalledWith('group.leaveFailed');
  });

  it('clear and delete are confirmed; delete also closes the chat', async () => {
    const m = menu({});
    m.find('header.clear')!.onSelect!(); await flush();
    expect(client.clearConversation).toHaveBeenCalledWith('c1');
    m.find('header.delete')!.onSelect!(); await flush(); await flush();
    expect(client.deleteConversation).toHaveBeenCalledWith('c1');
    expect(m.handlers.close).toHaveBeenCalled();
  });

  it('info, search and close call their handlers', () => {
    const m = menu({});
    m.find('header.contactInfo')!.onSelect!(); m.find('header.search')!.onSelect!(); m.find('header.close')!.onSelect!();
    expect(m.handlers.info).toHaveBeenCalled(); expect(m.handlers.search).toHaveBeenCalled(); expect(m.handlers.close).toHaveBeenCalled();
  });
});
