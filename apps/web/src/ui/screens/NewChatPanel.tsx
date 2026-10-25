import { useEffect, useState } from 'react';
import type { AccountDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import { labelOf } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useConversations } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { GuestBadge } from '../components/GuestBadge';

/**
 * "New chat" side panel: New group and Note to self entries, then organization directory search
 * by name, @handle or phone number (ADR-0002).
 */
export function NewChatPanel({
  client,
  onBack,
  onPick,
  onNewGroup,
  onNoteToSelf,
}: {
  client: EnclaveClient;
  onBack: () => void;
  onPick: (account: AccountDto) => void;
  onNewGroup: () => void;
  onNoteToSelf: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const results = useDirectorySearch(client, query);

  return (
    <>
      <header className="panel-header sub">
        <button className="icon-btn" onClick={onBack} aria-label={t('thread.back')}>
          <Icon name="back" />
        </button>
        <h2>{t('newChat.title')}</h2>
      </header>
      <div className="panel-search">
        <label className="search">
          <Icon name="search" size={18} />
          <input
            autoFocus
            type="search"
            placeholder={t('newChat.searchNameOrNumber')}
            aria-label={t('newChat.searchNameOrNumber')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="directory-search"
          />
        </label>
      </div>
      <div className="panel-body">
        {!query && (
          <ul className="list">
            <li>
              <button className="row action" onClick={onNewGroup} data-testid="new-group">
                <span className="action-icon">
                  <Icon name="group" />
                </span>
                <span className="row-main">
                  <span className="row-title">{t('newChat.newGroup')}</span>
                </span>
                <span />
              </button>
            </li>
            <li>
              <button className="row action" onClick={onNoteToSelf} data-testid="note-to-self">
                <span className="action-icon">
                  <Icon name="note" />
                </span>
                <span className="row-main">
                  <span className="row-title">{t('chats.noteToSelf')}</span>
                  <span className="row-preview">{t('newChat.messageYourself')}</span>
                </span>
                <span />
              </button>
            </li>
          </ul>
        )}
        <div className="section-label">{t('newChat.contacts')}</div>
        {!query && <p className="muted-text" style={{ padding: '0 16px' }}>{t('newChat.hint')}</p>}
        {results && results.length === 0 && <p className="muted-text" style={{ padding: '0 16px' }}>{t('newChat.none')}</p>}
        <ul className="list">
          {results?.map((a) => (
            <li key={a.accountId}>
              <PersonRow account={a} onClick={() => onPick(a)} testId={`directory-${a.username}`} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** One directory person: avatar, name, handle and phone. */
export function PersonRow({ account, onClick, testId, trailing }: { account: AccountDto; onClick: () => void; testId?: string; trailing?: React.ReactNode }) {
  return (
    <button className="row" onClick={onClick} data-testid={testId}>
      <Avatar id={account.accountId} name={labelOf(account)} />
      <span className="row-main">
        <span className="row-title">{labelOf(account)} <GuestBadge account={account} /></span>
        <span className="row-preview">
          @{account.username}
          {account.phone ? ` · ${account.phone}` : ''}
        </span>
      </span>
      {trailing ?? <span />}
    </button>
  );
}

/** Debounced organization directory search; excludes the current account. */
export function useDirectorySearch(client: EnclaveClient, query: string): AccountDto[] | null {
  const [results, setResults] = useState<AccountDto[] | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      client
        .searchDirectory(q)
        .then((r) => !cancelled && setResults(r.filter((a) => a.accountId !== client.accountId)))
        .catch(() => !cancelled && setResults([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query]);
  return results;
}

/** Contacts from existing direct conversations, ordered by the most recent conversation. */
export function useRecentContacts(client: EnclaveClient): AccountDto[] {
  const conversations = useConversations(client);
  const [contacts, setContacts] = useState<AccountDto[]>([]);
  useEffect(() => {
    let cancelled = false;
    const recent = conversations.filter((c) => c.kind === 'direct' && c.id !== client.accountId)
      .sort((a, b) => b.lastActivity - a.lastActivity);
    void Promise.all(recent.map((c) => client.account(c.id).catch(() => undefined)))
      .then((accounts) => { if (!cancelled) setContacts(accounts.filter((a): a is AccountDto => Boolean(a))); });
    return () => { cancelled = true; };
  }, [client, conversations]);
  return contacts;
}
