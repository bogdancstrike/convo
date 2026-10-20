import { useEffect, useState } from 'react';
import type { AccountDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import { Avatar } from './Avatar';
import { useI18n } from '../i18n/i18n';

/**
 * Directory search with multi-select chips (UI.md §2: handles only, no phonebook). Used by group
 * creation and member addition.
 */
export function PeoplePicker({
  client,
  selected,
  onChange,
  exclude = [],
}: {
  client: EnclaveClient;
  selected: AccountDto[];
  onChange: (selected: AccountDto[]) => void;
  exclude?: string[];
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AccountDto[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      client
        .searchDirectory(q)
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query]);

  const hidden = new Set([client.accountId, ...exclude, ...selected.map((s) => s.accountId)]);
  return (
    <div className="people-picker">
      {selected.length > 0 && (
        <ul className="pending-files" aria-label={t('group.selected')}>
          {selected.map((p) => (
            <li key={p.accountId} data-testid={`picked-${p.username}`}>
              <span>@{p.username}</span>
              <button className="btn-icon" aria-label={t('thread.removeFile', { name: p.username })}
                onClick={() => onChange(selected.filter((s) => s.accountId !== p.accountId))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        className="input"
        type="search"
        placeholder={t('newChat.placeholder')}
        aria-label={t('newChat.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="people-search"
      />
      <ul className="results">
        {results.filter((r) => !hidden.has(r.accountId)).map((a) => (
          <li key={a.accountId}>
            <button
              onClick={() => {
                onChange([...selected, a]);
                setQuery('');
              }}
              data-testid={`pick-${a.username}`}
            >
              <Avatar id={a.accountId} name={a.username} size={32} />
              <span>@{a.username}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
