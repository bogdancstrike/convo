import { useEffect } from 'react';
import type { EnclaveClient } from '../core/client';
import { useChatLocks } from './chatLocks';
import { useI18n } from './i18n/i18n';

/**
 * Browser system notifications for new messages (opt-in per device, Settings → Notifications).
 *
 * The shared core decides *whether* a message alerts (mute, "mentions only", blocking). This
 * controller adds device rules: permission, the chat already on screen, and the preview level.
 * Previews are generic by default; locked chats and an app lock always force generic content.
 */
export function useMessageNotifications(client: EnclaveClient, activeChat: string | null, open: (conversationId: string) => void): void {
  const { t } = useI18n();
  const locks = useChatLocks();
  useEffect(() => client.on('alert', (alert) => {
    const settings = client.settings;
    if (!settings.notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus() && activeChat === alert.conversationId) return;
    const preview = locks.locked(alert.conversationId) || settings.appLock ? 'generic' : settings.notificationPreview;
    void (async () => {
      const conversation = client.conversation(alert.conversationId);
      const sender = await client.displayName(alert.authorId);
      const title = preview === 'generic' ? 'Convo'
        : conversation?.kind === 'group' ? `${sender} · ${conversation.title}` : sender;
      const body = preview === 'full'
        ? (alert.body ?? (alert.attachment ? `📎 ${t('attachment.file')}` : t('notify.new')))
        : t(alert.mention ? 'notify.mention' : 'notify.new');
      // One notification per chat (tag) so a busy chat does not flood the system tray.
      const notification = new Notification(title, { body, tag: preview === 'generic' ? 'convo' : alert.conversationId, icon: '/logo.svg' });
      notification.onclick = () => { window.focus(); open(alert.conversationId); notification.close(); };
    })();
  }), [client, activeChat, open, locks, t]);

  // Local event reminders (Going/Maybe): same permission and preview rules as messages.
  useEffect(() => client.on('reminder', (reminder) => {
    const settings = client.settings;
    if (!settings.notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const generic = locks.locked(reminder.conversationId) || settings.appLock || settings.notificationPreview === 'generic';
    const minutes = String(Math.max(1, Math.round((reminder.start - Date.now()) / 60_000)));
    const notification = new Notification(generic ? 'Convo' : `📅 ${reminder.title}`, {
      body: generic ? t('notify.reminderGeneric') : t('notify.reminderBody', { count: minutes }),
      tag: `reminder:${reminder.messageId}`, icon: '/logo.svg' });
    notification.onclick = () => { window.focus(); open(reminder.conversationId); notification.close(); };
  }), [client, open, locks, t]);
}
