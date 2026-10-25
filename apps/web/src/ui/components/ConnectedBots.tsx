import { useEffect, useState } from 'react';
import type { AccountDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import type { Conversation } from '../../core/model';
import { useI18n } from '../i18n/i18n';
import { Icon } from './Icon';

/**
 * Addressed-only bots of a group (AC-INT-02): listed for everyone; owners/admins connect or
 * disconnect them. A connected bot is not a member and holds no group keys — it receives a separate
 * copy of each message that mentions it, and answers appear in the group marked as from the bot.
 */
export function ConnectedBots({ client, conversation, canManage }: { client: EnclaveClient; conversation: Conversation; canManage: boolean }) {
  const { t } = useI18n();
  const [bots, setBots] = useState<{ accountId: string; name: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AccountDto[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => void client.connectedBots(conversation.id).then((b) => { if (!cancelled) setBots(b); });
    load();
    const off = client.on('groups', load);
    return () => { cancelled = true; off(); };
  }, [client, conversation.id]);
  useEffect(() => {
    if (!query.trim()) { setResults([]); return undefined; }
    const timer = setTimeout(() => void client.searchDirectory(query.trim()).then((r) => setResults(r.filter((a) => a.integration?.kind === 'bot'))).catch(() => setResults([])), 200);
    return () => clearTimeout(timer);
  }, [client, query]);
  const change = async (botId: string, connected: boolean) => {
    setError(false);
    try { await client.setConnectedBot(conversation.id, botId, connected); setAdding(false); setQuery(''); } catch { setError(true); }
  };
  if (!bots.length && !canManage) return null;
  return (
    <section className="drawer-section" data-testid="connected-bots">
      <h4>{t('bots.title')}</h4>
      <p className="muted-text" style={{ margin: 0 }}>{t('bots.explain')}</p>
      <ul className="list">
        {bots.map((b) => (
          <li key={b.accountId} className="row" data-testid={`connected-bot-${b.accountId}`}>
            <Icon name="bot" size={18} /> <span className="row-main">{b.name}</span>
            {canManage && <button className="btn btn-ghost" onClick={() => void change(b.accountId, false)} data-testid="disconnect-bot">{t('bots.disconnect')}</button>}
          </li>
        ))}
      </ul>
      {canManage && (adding ? (
        <>
          <label className="search">
            <Icon name="search" size={16} />
            <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('bots.search')} aria-label={t('bots.search')} data-testid="bot-search" />
          </label>
          <ul className="list">
            {results.map((a) => (
              <li key={a.accountId}><button className="row" onClick={() => void change(a.accountId, true)} data-testid={`connect-bot-${a.username}`}>{a.displayName || a.username} <span className="muted-text">@{a.username}</span></button></li>
            ))}
          </ul>
        </>
      ) : <button className="btn" onClick={() => setAdding(true)} data-testid="add-bot">{t('bots.connect')}</button>)}
      {error && <p className="error-text" role="alert">{t('bots.failed')}</p>}
    </section>
  );
}
