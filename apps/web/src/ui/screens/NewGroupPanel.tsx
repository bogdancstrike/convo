import { useRef, useState } from 'react';
import type { AccountDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import { MembersUnavailableError } from '../../core/groups';
import { labelOf, type Conversation } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import { PersonRow, useDirectorySearch, useRecentContacts } from './NewChatPanel';

/**
 * Two-step group wizard (UI.md §5.4): 1) pick members (chips + directory search),
 * 2) group subject → create an MLS group whose name is end-to-end encrypted.
 */
export function NewGroupPanel({
  client,
  onBack,
  onCreated,
  channel = false,
}: {
  client: EnclaveClient;
  channel?: boolean;
  onBack: () => void;
  onCreated: (conversation: Conversation) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<'members' | 'subject' | 'review'>('members');
  const [selected, setSelected] = useState<AccountDto[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = useRef(false);
  const results = useDirectorySearch(client, query);
  const recent = useRecentContacts(client);
  const choices = query.trim() ? results ?? [] : recent;

  const toggle = (a: AccountDto) =>
    setSelected((s) => (s.some((x) => x.accountId === a.accountId) ? s.filter((x) => x.accountId !== a.accountId) : [...s, a]));

  const create = async () => {
    if (creating.current || !name.trim() || !selected.length) return;
    creating.current = true;
    setBusy(true);
    setError(null);
    try {
      onCreated(await client.createGroup(name, selected, channel));
    } catch (e) {
      if (e instanceof MembersUnavailableError) {
        const names = selected.filter((s) => e.accountIds.includes(s.accountId)).map(labelOf).join(', ');
        setError(t('group.unavailable', { names }));
      } else {
        setError(t('group.createFailed'));
      }
    } finally {
      creating.current = false;
      setBusy(false);
    }
  };

  if (step === 'review') return <>
    <header className="panel-header sub"><button className="icon-btn" disabled={busy} onClick={() => setStep('subject')} aria-label={t('thread.back')}><Icon name="back" /></button><h2>{t('wizard.review')}</h2></header>
    <WizardProgress current={2} />
    <div className="panel-body wizard-review"><Avatar id={name} name={name.trim()} size={88} group /><h2>{name.trim()}</h2>
      <p className="notice"><Icon name={channel ? 'channels' : 'group'} />{t(channel ? 'wizard.channelRule' : 'wizard.groupRule')}</p>
      <h3>{t('group.participants', { count: selected.length + 1 })}</h3>
      <div className="wizard-person"><Avatar id={client.accountId} name={labelOf(client.device)} size={36} /><span>{t('chats.you')}</span><span className="role-tag">{t('group.role.owner')}</span></div>
      {selected.map((person) => <div className="wizard-person" key={person.accountId}><Avatar id={person.accountId} name={labelOf(person)} size={36} /><span>{labelOf(person)}</span><span className="muted-text">@{person.username}</span></div>)}
      <p className="muted-text"><Icon name="lock" size={16} />{t('group.encryptedHint')}</p>
      {error && <p role="alert" className="failed">{error}</p>}
    </div><div className="panel-footer"><button className="btn btn-primary" disabled={busy} onClick={() => void create()} data-testid="create-group">{t(busy ? 'wizard.creating' : channel ? 'wizard.createChannel' : 'group.create')}</button></div>
  </>;

  if (step === 'subject') {
    return (
      <>
        <header className="panel-header sub">
          <button className="icon-btn" onClick={() => setStep('members')} aria-label={t('thread.back')}>
            <Icon name="back" />
          </button>
          <h2>{t(channel ? 'channel.new' : 'group.new')}</h2>
        </header>
        <WizardProgress current={1} />
        <div className="panel-body" style={{ display: 'grid', alignContent: 'start', gap: 20, padding: 24 }}>
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <Avatar id={name || 'new-group'} name={name || '?'} size={120} group />
          </div>
          <label className="field">
            <span>{t(channel ? 'wizard.channelName' : 'group.subject')}</span>
            <input
              className="underline-input"
              autoFocus
              placeholder={t('group.subjectHint')}
              maxLength={128}
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[\u0000-\u001f\u007f]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !busy) { e.preventDefault(); setStep('review'); } }}
              data-testid="group-name"
            />
          </label>
          <p className="muted-text">{t(channel ? 'channel.readOnly' : 'group.encryptedHint')}</p>
          <p className="muted-text">{t('group.participants', { count: selected.length + 1 })}</p>
          {error && <p role="alert" className="failed">{error}</p>}
        </div>
        <div className="panel-footer">
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => setStep('review')} data-testid="review-group">{t('wizard.review')}<Icon name="next" size={20} /></button>
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
        <h2>{t(channel ? 'wizard.channelMembers' : 'group.addParticipants')}</h2>
      </header>
      <WizardProgress current={0} />
      <p className="wizard-help muted-text">{t(channel ? 'wizard.channelHelp' : 'wizard.groupHelp')}</p>
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
        {!query.trim() && <div className="section-label">{t('group.recentContacts')}</div>}
        {!query.trim() && !recent.length && <p className="muted-text" style={{ padding: '8px 16px' }}>{t('group.noRecentContacts')}</p>}
        <ul className="list">
          {choices.map((a) => {
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

function WizardProgress({ current }: { current: number }) {
  const { t } = useI18n();
  return <ol className="wizard-progress" aria-label={t('wizard.progress')}>{(['wizard.members', 'wizard.details', 'wizard.review'] as const).map((key, i) => <li key={key} aria-current={i === current ? 'step' : undefined} data-complete={i < current}><span>{i + 1}</span>{t(key)}</li>)}</ol>;
}
