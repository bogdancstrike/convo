import { useMessageNotifications } from '../notifications';
import { LockedChatGate, useChatLocks } from '../chatLocks';
import { CallsPanel } from '../calls/CallsPanel';
import { AllMedia } from './AllMedia';
import { MediaViewerProvider } from '../components/MediaViewer';
import { ContactDrawer } from './ContactDrawer';
import { ConversationSubpage } from './ConversationDetails';
import { LinkPreferences } from '../components/ExternalLink';
import { ProfilesProvider } from '../components/ProfileContext';
import { SharedContent, type SharedTab } from './SharedContent';
import { useEffect, useRef, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { labelOf } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { useConnection, useConversations } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { escapeNavigation, useNavigation } from '../navigation';
import { ChatListPanel } from './ChatListPanel';
import { InfoDrawer } from './InfoDrawer';
import { NewChatPanel } from './NewChatPanel';
import { NewGroupPanel } from './NewGroupPanel';
import { SettingsPanel, SettingsNavigation } from './SettingsPanel';
import { Thread } from './Thread';
import { WelcomePane } from './WelcomePane';

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
  const [chatSearch, setChatSearch] = useState<{ id: string; query: string } | null>(null);
  const [allMedia, setAllMedia] = useState(false);
  const [pendingPicker, setPendingPicker] = useState<'document' | null>(null);
  const active = nav.chat ? (conversations.find((c) => c.id === nav.chat) ?? null) : null;
  const unread = conversations.reduce((n, c) => n + (c.archived ? 0 : c.unread), 0);
  const locks = useChatLocks();
  // Leaving an unlocked chat locks it again; its info/media pages keep the grant (same chat id).
  const previousChat = useRef(nav.chat);
  useEffect(() => {
    const left = previousChat.current;
    previousChat.current = nav.chat;
    if (left && left !== nav.chat && left === locks.unlockedChat) locks.relock();
  }, [nav.chat, locks]);
  const lockedActive = active ? locks.hidden(active.id) : false;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open], .message-menu, .floating-menu, .emoji-picker')) return;
      event.preventDefault(); navigate(escapeNavigation(nav));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [nav, navigate]);

  useEffect(() => {
    const heartbeat = () => { if (document.visibilityState === 'visible') void client.lastSeenHeartbeat().catch(() => undefined); };
    heartbeat(); const timer = setInterval(heartbeat, 20000);
    document.addEventListener('visibilitychange', heartbeat);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', heartbeat); };
  }, [client]);

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

  const openChat = (id: string) => { setChatSearch(null); navigate({ panel: 'chats', chat: id, info: false }); };
  useMessageNotifications(client, nav.chat, openChat);
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
      case 'calls':
        return <CallsPanel client={client} onOpenChat={openChat} />;
      case 'new-channel':
        return <NewGroupPanel client={client} channel onBack={() => navigate({ panel: 'channels' })} onCreated={(c) => openChat(c.id)} />;
      case 'new-group':
        return <NewGroupPanel client={client} onBack={() => navigate({ panel: 'new' })} onCreated={(c) => openChat(c.id)} />;
      case 'settings':
        return (
          <SettingsNavigation
            onAllMedia={() => setAllMedia(true)}
            onSignedOut={onSignedOut}
            client={client}
            page={nav.page}
            onNavigate={(page) => navigate({ page })}
            onBack={() => navigate({ panel: 'chats' })}
          />
        );
      default:
        return (
          <ChatListPanel
            client={client}
            conversations={conversations}
            channels={nav.panel === 'channels'}
            activeId={active?.id ?? null}
            onSelect={openChat}
            onInfo={(id) => navigate({ chat: id, info: true })}
            onSearch={(id, query) => { setChatSearch({ id, query }); navigate({ chat: id, info: false }); }}
            onClose={(id) => { if (active?.id === id) navigate({ chat: null, info: false }); }}
            onNewChat={() => navigate({ panel: nav.panel === 'channels' ? 'new-channel' : 'new', chat: null })}
          />
        );
    }
  })();

  const pane = active ? 'thread' : 'list';
  return (
    <ProfilesProvider client={client}><LinkPreferences client={client}><MediaViewerProvider client={client}><div className="shell" data-settings={nav.panel === 'settings'} data-pane={pane} data-drawer={active && nav.info ? 'open' : 'closed'}>
      <nav className="rail" aria-label={t('appName')}>
        <span className="brand">
          <Logo size={36} />
        </span>
        <button
          className="rail-btn"
          aria-current={nav.panel === 'chats' ? 'page' : undefined}
          onClick={() => navigate({ panel: 'chats' })}
          aria-label={t('nav.chats')}
          title={t('nav.chats')}
          data-testid="nav-chats"
        >
          <Icon name="chats" />
          {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button className="rail-btn" aria-label={t('nav.calls')} title={t('nav.calls')} aria-current={nav.panel === 'calls' ? 'page' : undefined}
          onClick={() => navigate({ panel: 'calls', chat: null, info: false })} data-testid="nav-calls"><Icon name="calls" /></button>
        <button className="rail-btn" aria-label={t('nav.channels')} title={t('nav.channels')} aria-current={nav.panel === 'channels' ? 'page' : undefined}
          onClick={() => navigate({ panel: 'channels', chat: null, info: false })} data-testid="nav-channels"><Icon name="channels" /></button>
        <span className="spacer" />
        <button className="rail-btn" onClick={() => setAllMedia(true)} aria-label={t('gallery.title')} title={t('gallery.title')} data-testid="nav-media"><Icon name="image" /></button>
        <button className="rail-btn" data-testid="nav-settings" onClick={() => navigate({ panel: 'settings', chat: null })} aria-label={`${t('settings.title')}: ${labelOf(client.device)}`} title={t('settings.title')} aria-current={nav.panel === 'settings' ? 'page' : undefined}>
          <Avatar id={client.accountId} name={labelOf(client.device)} size={30} />
        </button>
      </nav>
      <section className="sidebar" aria-label={t('nav.chats')}>
        {sidebar}
      </section>
      {active && lockedActive ? (
        <LockedChatGate conversationId={active.id} onBack={() => navigate({ chat: null, info: false })} />
      ) : active ? (
        <Thread
          key={active.id}
          client={client}
          conversation={active}
          connection={connection}
          openPicker={pendingPicker}
          initialSearch={chatSearch?.id === active.id ? chatSearch.query : undefined}
          onBack={() => navigate({ chat: null, info: false })}
          onInfo={() => navigate({ info: !nav.info })}
          onClose={() => navigate({ chat: null, info: false })}
          onOpenConversation={openChat}
        />
      ) : nav.panel === 'calls' ? (<section className="welcome-pane"><div className="welcome-inner"><Icon name="calls" size={64} /><h2>{t('nav.calls')}</h2><p>{t('calls.welcome')}</p></div></section>) : nav.panel === 'settings' ? (
        <section className="settings-workspace"><SettingsPanel onAllMedia={() => setAllMedia(true)} client={client} page={nav.page} onNavigate={(page) => navigate({ page })} onBack={() => navigate({ panel: 'chats' })} onSignedOut={onSignedOut} /></section>
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
      {active && !lockedActive && nav.info && (() => {
        const parts = nav.page?.split(':') ?? [];
        const contactId = parts[0] === 'contact' ? parts[1] : undefined;
        const page = contactId ? parts[2] : nav.page;
        const parent = contactId ? `contact:${contactId}` : null;
        const onPage = (next: string) => navigate({ page: contactId ? `${parent}:${next}` : next });
        const view = contactId ? client.conversation(contactId) ?? { ...active, id: contactId, kind: 'direct' as const } : active;
        if (page === 'starred' || page === 'appearance') return <ConversationSubpage client={client} conversation={view} page={page} onBack={() => navigate({ page: parent })} />;
        if (page && ['media', 'links', 'docs'].includes(page)) return <SharedContent key={view.id} client={client} conversationId={view.id} tab={page as SharedTab} onTab={onPage} onBack={() => navigate({ page: parent })} />;
        if (contactId) return <ContactDrawer client={client} accountId={contactId} onBack={() => navigate({ page: null })} onPage={onPage} onGroup={openChat} onMessage={() => {
          void client.account(contactId).then((account) => account && client.openConversation(account).then((c) => openChat(c.id)));
        }} />;
        return <InfoDrawer client={client} conversation={active} onClose={() => navigate({ info: false, page: null })}
          onShared={() => navigate({ page: 'media' })} onPage={onPage} onContact={(id) => navigate({ page: `contact:${id}` })} />;
      })()}
    </div>{allMedia && <AllMedia client={client} onClose={() => setAllMedia(false)} />}</MediaViewerProvider></LinkPreferences></ProfilesProvider>
  );
}
