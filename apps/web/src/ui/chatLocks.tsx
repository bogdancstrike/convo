import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { EnclaveClient } from '../core/client';
import { PasskeyUnavailableError, verifyWithPasskey } from './passkeyUnlock';
import { useI18n } from './i18n/i18n';
import { Icon } from './components/Icon';

/**
 * Chats that require passkey verification to open (web counterpart of Android's chat lock).
 *
 * Available once the identity provider confirms a passkey. A locked chat is hidden from the chat
 * list, search and global media; opening it asks for the passkey and the grant lasts until the user
 * leaves that chat (its info and media pages keep it).
 */
interface ChatLocks {
  /** `true` once the IdP confirmed a passkey for this account. */
  passkey: boolean | null;
  locked: (id: string) => boolean;
  /** Locked and not currently unlocked. */
  hidden: (id: string) => boolean;
  unlockedChat: string | null;
  /** Asks for the passkey; resolves true when verified. */
  verify: () => Promise<boolean>;
  unlock: (id: string) => Promise<boolean>;
  relock: () => void;
  /** Grants a chat opened from the already-verified Locked chats list. */
  grant: (id: string) => void;
  /** Toggle "require passkey" for a chat (verification first). */
  toggle: (id: string) => Promise<void>;
  error: string | null;
  clearError: () => void;
  /** App-wide lock (Settings → Privacy) is engaged; content is not rendered. */
  appLocked: boolean;
  unlockApp: () => Promise<void>;
  /** Turns the app lock on/off after verifying the passkey. */
  setAppLock: (on: boolean) => Promise<void>;
}

const Context = createContext<ChatLocks | null>(null);
export function useChatLocks(): ChatLocks {
  const value = useContext(Context);
  if (!value) throw new Error('useChatLocks outside ChatLockProvider');
  return value;
}

export function ChatLockProvider({ client, children }: { client: EnclaveClient; children: ReactNode }) {
  const { t } = useI18n();
  const unavailableMessage = t('lock.unavailable', { host: window.location.hostname });
  const [passkey, setPasskey] = useState(client.passkeyEnrolled);
  const [lockedChats, setLockedChats] = useState(client.settings.lockedChats);
  const [unlockedChat, setUnlockedChat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Locked on start when enabled: a reload or a new tab never shows content without the passkey.
  const [appLocked, setAppLocked] = useState(client.settings.appLock);
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      const settings = client.settings;
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); if (settings.appLock && settings.appLockAfterMinutes === 0) setAppLocked(true); return; }
      if (settings.appLock && hiddenAt && Date.now() - hiddenAt >= Math.min(settings.appLockAfterMinutes, client.policy.security.appLockMaxMinutes) * 60_000) setAppLocked(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [client]);
  useEffect(() => client.on('credentials', setPasskey), [client]);
  useEffect(() => client.on('settings', (s) => setLockedChats(s.lockedChats)), [client]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void client.credentialStatus(); };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [client]);

  const verify = useCallback(async () => {
    setError(null);
    try { return await verifyWithPasskey(); }
    catch (e) { if (e instanceof PasskeyUnavailableError) setError(unavailableMessage); return false; }
  }, [unavailableMessage]);
  const unlock = useCallback(async (id: string) => {
    const ok = await verify();
    if (ok) setUnlockedChat(id);
    return ok;
  }, [verify]);
  const toggle = useCallback(async (id: string) => {
    const lock = !lockedChats.includes(id);
    if (lock && passkey !== true) return;
    if (!(await verify())) return;
    await client.setChatLocked(id, lock);
    setUnlockedChat(lock ? null : unlockedChat);
  }, [client, lockedChats, passkey, unlockedChat, verify]);

  const unlockApp = useCallback(async () => { if (await verify()) { setAppLocked(false); setUnlockedChat(null); } }, [verify]);
  const setAppLock = useCallback(async (on: boolean) => {
    if (on && passkey !== true) return;
    if (await verify()) await client.updateSettings({ appLock: on });
  }, [client, passkey, verify]);
  const locked = useCallback((id: string) => lockedChats.includes(id), [lockedChats]);
  const hidden = useCallback((id: string) => lockedChats.includes(id) && unlockedChat !== id, [lockedChats, unlockedChat]);
  return (
    <Context.Provider value={{ passkey, locked, hidden, unlockedChat, verify, unlock, relock: () => setUnlockedChat(null), grant: setUnlockedChat, toggle, error, clearError: () => setError(null), appLocked, unlockApp, setAppLock }}>
      {appLocked ? <AppLockScreen /> : children}
    </Context.Provider>
  );
}

/** Stands in for a locked chat (direct links, back/forward) until the passkey is verified. */
export function LockedChatGate({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const { t } = useI18n();
  const locks = useChatLocks();
  return (
    <section className="welcome-pane" data-testid="locked-chat">
      <div className="welcome-inner">
        <Icon name="lock" size={56} />
        <h2>{t('lock.gateTitle')}</h2>
        <p>{t('lock.gateBody')}</p>
        {locks.error && <p role="alert" className="failed">{locks.error}</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button className="btn" onClick={onBack}>{t('thread.back')}</button>
          <button className="btn btn-primary" onClick={() => void locks.unlock(conversationId)} data-testid="unlock-chat">{t('lock.unlock')}</button>
        </div>
      </div>
    </section>
  );
}

/** Full-window lock for the whole web app (no chat content is rendered behind it). */
function AppLockScreen() {
  const { t } = useI18n();
  const locks = useChatLocks();
  useEffect(() => { void locks.unlockApp(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- prompt once on show
  return (
    <main className="welcome-pane app-lock" data-testid="app-locked">
      <div className="welcome-inner">
        <Icon name="lock" size={64} />
        <h2>{t('appLock.title')}</h2>
        <p>{t('appLock.body')}</p>
        {locks.error && <p role="alert" className="failed">{locks.error}</p>}
        <button className="btn btn-primary" onClick={() => void locks.unlockApp()} data-testid="unlock-app">{t('lock.unlock')}</button>
      </div>
    </main>
  );
}
