import { useEffect, useState } from 'react';
import type { AccountDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import { Avatar } from '../components/Avatar';
import { Dialog } from '../components/Dialog';
import { useI18n } from '../i18n/i18n';

/** Directory search by organization handle (UI.md §2: no phonebook import). */
export function NewChatDialog({
  client,
  onPick,
  onClose,
}: {
  client: EnclaveClient;
  onPick: (account: AccountDto) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
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
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query]);

  return (
    <Dialog labelledBy="new-chat-title" onClose={onClose}>
      <h2 id="new-chat-title">{t('newChat.title')}</h2>
      <input
        className="input"
        autoFocus
        type="search"
        placeholder={t('newChat.placeholder')}
        aria-label={t('newChat.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="directory-search"
      />
      {results && results.length === 0 && <p className="muted-text">{t('newChat.none')}</p>}
      {results && results.length > 0 && (
        <ul className="results">
          {results.map((a) => (
            <li key={a.accountId}>
              <button onClick={() => onPick(a)} data-testid={`directory-${a.username}`}>
                <Avatar id={a.accountId} name={a.username} size={36} />
                <span>@{a.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn" onClick={onClose}>
        {t('newChat.close')}
      </button>
    </Dialog>
  );
}
