import { useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { Icon } from '../components/Icon';
import { useConnection, useConversations } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { ChatList } from './ChatList';
import { GroupInfoDialog } from './GroupInfoDialog';
import { NewGroupDialog } from './NewGroupDialog';
import { NewChatDialog } from './NewChatDialog';
import { SafetyNumberDialog } from './SafetyNumberDialog';
import { SettingsPane } from './Settings';
import { Thread } from './Thread';

type Destination = 'chats' | 'settings';

/** Application shell (UI.md §2.2): navigation rail, conversation list and thread/settings pane. */
export function MainLayout({ client, onSignedOut }: { client: EnclaveClient; onSignedOut: () => void }) {
  const { t } = useI18n();
  const conversations = useConversations(client);
  const connection = useConnection(client);
  const [destination, setDestination] = useState<Destination>('chats');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'new-chat' | 'new-group' | 'safety' | 'group-info' | null>(null);
  const active = conversations.find((c) => c.id === activeId) ?? null;

  const open = async (accountId: string, username: string) => {
    const conversation = await client.openConversation({ accountId, username });
    setDestination('chats');
    setActiveId(conversation.id);
    setDialog(null);
  };

  const pane = destination === 'settings' ? 'settings' : active ? 'thread' : 'list';

  return (
    <div className="shell" data-pane={pane}>
      <nav className="rail" aria-label="Enclave">
        <button aria-current={destination === 'chats' ? 'page' : undefined} onClick={() => setDestination('chats')}>
          <Icon name="chats" />
          {t('nav.chats')}
        </button>
        <span className="spacer" />
        <button
          aria-current={destination === 'settings' ? 'page' : undefined}
          onClick={() => setDestination('settings')}
          data-testid="nav-settings"
        >
          <Icon name="settings" />
          {t('nav.settings')}
        </button>
      </nav>
      {destination === 'chats' ? (
        <>
          <ChatList
            conversations={conversations}
            activeId={activeId}
            onSelect={setActiveId}
            onNewChat={() => setDialog('new-chat')}
            onNewGroup={() => setDialog('new-group')}
            onNoteToSelf={() => void open(client.accountId, client.device.username)}
          />
          {active ? (
            <Thread
              client={client}
              conversation={active}
              connection={connection}
              onBack={() => setActiveId(null)}
              onVerify={() => setDialog(active.kind === 'group' ? 'group-info' : 'safety')}
            />
          ) : (
            <section className="thread">
              <div className="empty" style={{ margin: 'auto' }}>
                <p>{t('thread.select')}</p>
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <span />
          <SettingsPane client={client} onSignedOut={onSignedOut} />
        </>
      )}
      {dialog === 'new-chat' && (
        <NewChatDialog client={client} onClose={() => setDialog(null)} onPick={(a) => void open(a.accountId, a.username)} />
      )}
      {dialog === 'new-group' && (
        <NewGroupDialog
          client={client}
          onClose={() => setDialog(null)}
          onCreated={(c) => {
            setDialog(null);
            setActiveId(c.id);
          }}
        />
      )}
      {dialog === 'group-info' && active && <GroupInfoDialog client={client} conversation={active} onClose={() => setDialog(null)} />}
      {dialog === 'safety' && active && (
        <SafetyNumberDialog client={client} conversation={active} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
