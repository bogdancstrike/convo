import { useState } from 'react';
import type { AccountDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import { MembersUnavailableError } from '../../core/groups';
import { labelOf, type Conversation } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import { PersonRow, useDirectorySearch } from './NewChatPanel';

/**
 * Two-step group wizard (UI.md §5.4): 1) pick members (chips + directory search),
 * 2) group subject → create an MLS group whose name is end-to-end encrypted.
 */
export function NewGroupPanel({
  client,
  onBack,
  onCreated,
}: {
  client: EnclaveClient;
  onBack: () => void;
  onCreated: (conversation: Conversation) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<'members' | 'subject'>('members');
  const [selected, setSelected] = useState<AccountDto[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = useDirectorySearch(client, query);

  const toggle = (a: AccountDto) =>
    setSelected((s) => (s.some((x) => x.accountId === a.accountId) ? s.filter((x) => x.accountId !== a.accountId) : [...s, a]));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await client.createGroup(name, selected));
    } catch (e) {
      if (e instanceof MembersUnavailableError) {
        const names = selected.filter((s) => e.accountIds.includes(s.accountId)).map(labelOf).join(', ');
        setError(t('group.unavailable', { names }));
      } else {
        setError(t('group.createFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === 'subject') {
    return (
      <>
        <header className="panel-header sub">
          <button className="icon-btn" onClick={() => setStep('members')} aria-label={t('thread.back')}>
            <Icon name="back" />
          </button>
          <h2>{t('group.new')}</h2>
        </header>
        <div className="panel-body" style={{ display: 'grid', alignContent: 'start', gap: 20, padding: 24 }}>
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <Avatar id={name || 'new-group'} name={name || '?'} size={120} group />
          </div>
          <label className="field">
            <span className="visually-hidden">{t('group.subject')}</span>
            <input
              className="underline-input"
              autoFocus
              placeholder={t('group.subjectHint')}
              maxLength={128}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && !busy && void create()}
              data-testid="group-name"
            />
          </label>
          <p className="muted-text">{t('group.encryptedHint')}</p>
          <p className="muted-text">{t('group.participants', { count: selected.length + 1 })}</p>
          {error && <p role="alert" className="failed">{error}</p>}
        </div>
        <div className="panel-footer">
          <button className="fab" disabled={busy || !name.trim()} onClick={() => void create()} aria-label={t('group.create')} data-testid="create-group">
            <Icon name="check" size={26} />
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="panel-header sub">
        <button className="icon-btn" onClick={onBack} aria-label={t('thread.back')}>
          <Icon name="back" />
        </button>
        <h2>{t('group.addParticipants')}</h2>
      </header>
      {selected.length > 0 && (
        <div className="selected-people" aria-label={t('group.selected')}>
          {selected.map((p) => (
            <span key={p.accountId} className="person-chip" data-testid={`picked-${p.username}`}>
              <Avatar id={p.accountId} name={labelOf(p)} size={24} />
              {labelOf(p)}
              <button onClick={() => toggle(p)} aria-label={t('thread.removeFile', { name: labelOf(p) })}>
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
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
            data-testid="people-search"
          />
        </label>
      </div>
      <div className="panel-body">
        {!query && <p className="muted-text" style={{ padding: '8px 16px' }}>{t('newChat.hint')}</p>}
        <ul className="list">
          {results?.map((a) => {
            const checked = selected.some((s) => s.accountId === a.accountId);
            return (
              <li key={a.accountId}>
                <PersonRow
                  account={a}
                  onClick={() => toggle(a)}
                  testId={`pick-${a.username}`}
                  trailing={
                    <span className="row-check" data-checked={checked}>
                      {checked && <Icon name="check" size={16} />}
                    </span>
                  }
                />
              </li>
            );
          })}
        </ul>
      </div>
      <div className="panel-footer">
        <button className="fab" disabled={selected.length === 0} onClick={() => setStep('subject')} aria-label={t('group.next')} data-testid="group-next">
          <Icon name="next" size={26} />
        </button>
      </div>
    </>
  );
}
