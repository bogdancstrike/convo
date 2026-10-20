import type { EnclaveClient } from '../../core/client';
import { isMuted, type Conversation } from '../../core/model';
import type { MenuItem } from '../components/Popover';
import type { I18n } from '../i18n/i18n';

const HOUR = 3_600_000;

/** Shared settings/actions for the list arrow and conversation header. */
export function conversationMenu(client: EnclaveClient, conversation: Conversation, t: I18n['t'],
  onInfo: () => void, onSearch: () => void, onClose: () => void): MenuItem[] {
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
