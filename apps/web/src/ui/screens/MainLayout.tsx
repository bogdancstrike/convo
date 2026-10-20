import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { labelOf } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { useConnection, useConversations } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { useNavigation } from '../navigation';
import { ChatListPanel } from './ChatListPanel';
import { InfoDrawer } from './InfoDrawer';
import { NewChatPanel } from './NewChatPanel';
import { NewGroupPanel } from './NewGroupPanel';
import { SettingsPanel } from './SettingsPanel';
import { Thread } from './Thread';
import { SettingsHome, WelcomePane } from './WelcomePane';

/**
 * Application shell (UI.md §2.2): navigation rail · side panel (chats, new chat, group wizard,
 * settings) · conversation or welcome pane · optional info drawer. Navigation lives in the URL
 * hash, so refresh and browser Back restore the same view.
 */
export function MainLayout({ client, onSignedOut }: { client: EnclaveClient; onSignedOut: () => void }) {
  const { t } = useI18n();
  const conversations = useConversations(client);
  const connection = useConnection(client);
  const [nav, navigate] = useNavigation();
  const [pendingPicker, setPendingPicker] = useState<'document' | null>(null);
  const active = nav.chat ? (conversations.find((c) => c.id === nav.chat) ?? null) : null;
  const unread = conversations.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0);

  // "Send document" opens the picker once, in the next chat the user picks.
  useEffect(() => {
    if (!pendingPicker || !active) return undefined;
    const timer = setTimeout(() => setPendingPicker(null), 500);
    return () => clearTimeout(timer);
  }, [pendingPicker, active]);

  // A stale deep link (deleted/unknown chat) falls back to the chat list.
  useEffect(() => {
    if (nav.chat && conversations.length > 0 && !active) navigate({ chat: null, info: false }, true);
  }, [nav.chat, active, conversations.length, navigate]);

  const openChat = (id: string) => navigate({ panel: 'chats', chat: id, info: false });
  const openNoteToSelf = async () => {
    const c = await client.openConversation({ accountId: client.accountId, username: client.device.username, displayName: client.device.displayName });
    openChat(c.id);
  };

  const sidebar = (() => {
    switch (nav.panel) {
      case 'new':
        return (
          <NewChatPanel
            client={client}
            onBack={() => navigate({ panel: 'chats' })}
            onNewGroup={() => navigate({ panel: 'new-group' })}
            onNoteToSelf={() => void openNoteToSelf()}
            onPick={(a) => void client.openConversation(a).then((c) => openChat(c.id))}
          />
        );
      case 'new-group':
        return <NewGroupPanel client={client} onBack={() => navigate({ panel: 'new' })} onCreated={(c) => openChat(c.id)} />;
      case 'settings':
        return (
          <SettingsPanel
            client={client}
            page={nav.page}
            onNavigate={(page) => navigate({ page })}
            onBack={() => navigate({ panel: 'chats' })}
            onSignedOut={onSignedOut}
          />
        );
      default:
        return (
          <ChatListPanel
            client={client}
            conversations={conversations}
            activeId={active?.id ?? null}
            onSelect={openChat}
            onNewChat={() => navigate({ panel: 'new', chat: null })}
          />
        );
    }
  })();

  const pane = active ? 'thread' : 'list';
  return (
    <div className="shell" data-pane={pane} data-drawer={active && nav.info ? 'open' : 'closed'}>
      <nav className="rail" aria-label={t('appName')}>
        <span className="brand">
          <Logo size={36} />
        </span>
        <button
          className="rail-btn"
          aria-current={nav.panel !== 'settings' ? 'page' : undefined}
          onClick={() => navigate({ panel: 'chats' })}
          aria-label={t('nav.chats')}
          title={t('nav.chats')}
          data-testid="nav-chats"
        >
          <Icon name="chats" />
          {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <span className="spacer" />
        <button
          className="rail-btn"
          aria-current={nav.panel === 'settings' ? 'page' : undefined}
          onClick={() => navigate({ panel: 'settings', chat: null })}
          aria-label={t('nav.settings')}
          title={t('nav.settings')}
          data-testid="nav-settings"
        >
          <Icon name="settings" />
        </button>
        <button className="rail-btn" onClick={() => navigate({ panel: 'settings', chat: null })} aria-label={labelOf(client.device)} title={labelOf(client.device)}>
          <Avatar id={client.accountId} name={labelOf(client.device)} size={30} />
        </button>
      </nav>
      <section className="sidebar" aria-label={t('nav.chats')}>
        {sidebar}
      </section>
      {active ? (
        <Thread
          key={active.id}
          client={client}
          conversation={active}
          connection={connection}
          openPicker={pendingPicker}
          onBack={() => navigate({ chat: null, info: false })}
          onInfo={() => navigate({ info: !nav.info })}
          onClose={() => navigate({ chat: null, info: false })}
          onOpenConversation={openChat}
        />
      ) : nav.panel === 'settings' ? (
        <SettingsHome />
      ) : (
        <WelcomePane
          onAction={(action) => {
            if (action === 'chat') navigate({ panel: 'new' });
            else if (action === 'group') navigate({ panel: 'new-group' });
            else if (action === 'note') void openNoteToSelf();
            else if (action === 'link') navigate({ panel: 'settings', page: 'devices' });
            else if (action === 'document') {
              setPendingPicker('document');
              navigate({ panel: 'new' });
            }
          }}
        />
      )}
      {active && nav.info && <InfoDrawer client={client} conversation={active} onClose={() => navigate({ info: false })} />}
    </div>
  );
}
