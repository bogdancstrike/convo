import { ApiError } from '../../api/errors';
import type { EnclaveClient } from '../../core/client';
import { isMuted, type Conversation } from '../../core/model';
import { isSnoozed } from '../../core/snooze';
import { openSnooze } from './SnoozeDialog';
import type { MenuItem } from '../components/Popover';
import type { I18n } from '../i18n/i18n';

const HOUR = 3_600_000;

/** Shared settings/actions for the list arrow and conversation header. */
export function conversationMenu(client: EnclaveClient, conversation: Conversation, t: I18n['t'],
  onInfo: () => void, onSearch: () => void, onClose: () => void,
  lock?: { locked: boolean; available: boolean; toggle: () => void }): MenuItem[] {
  const group = conversation.kind === 'group';
  const confirmThen = (question: string, run: () => Promise<void>) => () => {
    if (window.confirm(question)) void run();
  };

  return [
    { label: group ? t('header.groupInfo') : t('header.contactInfo'), icon: 'info', onSelect: onInfo, testId: 'menu-info' },
    { label: t('header.search'), icon: 'search', onSelect: onSearch },
    isMuted(conversation)
      ? { label: t('header.unmuteNow'), icon: 'mute', onSelect: () => void client.setMute(conversation.id, null) }
      : {
          label: t('header.mute'),
          icon: 'mute',
          testId: 'menu-mute',
          children: [
            { label: t('header.mute8h'), onSelect: () => void client.setMute(conversation.id, Date.now() + 8 * HOUR) },
            { label: t('header.mute1w'), onSelect: () => void client.setMute(conversation.id, Date.now() + 7 * 24 * HOUR) },
            { label: t('header.muteAlways'), onSelect: () => void client.setMute(conversation.id, Infinity), testId: 'menu-mute-always' },
          ],
        },
    isSnoozed(conversation.snooze)
      ? { label: t('snooze.end', { when: new Date(conversation.snooze!.until).toLocaleString() }), icon: 'clock' as const, testId: 'menu-snooze-end',
        onSelect: () => void client.setSnooze(conversation.id, null) }
      : { label: t('snooze.menu'), icon: 'clock' as const, testId: 'menu-snooze', onSelect: () => openSnooze(conversation.id) },
    ...(group ? [{
      label: conversation.notify === 'mentions' ? t('notify.allMessages') : t('notify.mentionsOnly'),
      icon: 'mute' as const, testId: 'menu-notify-mode',
      onSelect: () => void client.updateConversation(conversation.id, { notify: conversation.notify === 'mentions' ? undefined : 'mentions' }),
    }] : []),
    {
      label: conversation.pinned ? t('header.unpin') : t('header.pin'),
      icon: 'pin',
      onSelect: () => void client.updateConversation(conversation.id, { pinned: !conversation.pinned }),
    },
    {
      label: conversation.archived ? t('header.unarchive') : t('header.archive'),
      icon: 'archive',
      onSelect: () => void client.updateConversation(conversation.id, { archived: !conversation.archived }),
    },
    // "Require passkey to open": offered once a passkey exists; turning it off is always possible.
    ...(lock && (lock.locked || lock.available) ? [{ label: lock.locked ? t('lock.disable') : t('lock.enable'), icon: 'lock' as const, onSelect: lock.toggle, testId: 'menu-lock' }] : []),
    ...(conversation.kind === 'direct' ? [conversation.blocked
      ? { label: t('block.unblock'), icon: 'shield' as const, onSelect: () => void client.setBlocked(conversation.id, false), testId: 'menu-unblock' }
      : { label: t('block.block'), icon: 'shield' as const, danger: true, onSelect: confirmThen(t('block.confirm', { name: conversation.title }), () => client.setBlocked(conversation.id, true)), testId: 'menu-block' }] : []),
    ...(group && !conversation.left ? [{ label: conversation.adminOnly ? t('group.leaveChannel') : t('group.leave'), icon: 'logout' as const, danger: true, testId: 'menu-leave',
      onSelect: confirmThen(t('group.leaveConfirm', { name: conversation.title }), () => client.leaveGroup(conversation.id).catch((e) => {
        window.alert(e instanceof ApiError && e.code === 'FORBIDDEN_ROLE' ? t('group.leaveOwner') : t('group.leaveFailed'));
      })) }] : []),
    { label: t('header.close'), icon: 'close', onSelect: onClose },
    { label: t('header.clear'), icon: 'trash', onSelect: confirmThen(t('header.confirmClear'), () => client.clearConversation(conversation.id)) },
    {
      label: t('header.delete'),
      icon: 'trash',
      danger: true,
      onSelect: confirmThen(t('header.confirmDelete'), async () => {
        await client.deleteConversation(conversation.id);
        onClose();
      }),
    },
  ];

}
