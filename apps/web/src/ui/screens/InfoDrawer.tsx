import { useProfile } from '../components/ProfileContext';
import { FingerprintGenerator } from '@privacyresearch/libsignal-protocol-typescript';
import { useCallback, useEffect, useState } from 'react';
import type { AccountDto, GroupRole } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import { GroupBusyError, MembersUnavailableError } from '../../core/groups';
import { labelOf, type Conversation } from '../../core/model';
import { fromBase64Url, toArrayBuffer } from '../../lib/bytes';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useAccount, useGroupRecord } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { PersonRow, useDirectorySearch } from './NewChatPanel';

/** Safety-number iterations (specs §5.6). */
const FINGERPRINT_ITERATIONS = 5200;

/**
 * Right-hand info drawer (UI.md §4.3, §5.4a): contact details with safety-number verification, or
 * group details with members, roles and admin add/remove.
 */
export function InfoDrawer({ client, conversation, onClose, onShared }: { client: EnclaveClient; conversation: Conversation; onClose: () => void; onShared: () => void }) {
  const { t } = useI18n();
  const group = conversation.kind === 'group';
  return (
    <aside className="drawer" aria-labelledby="drawer-title" data-testid="info-drawer">
      <header className="panel-header sub" style={{ background: 'var(--c-panel)' }}>
        <button className="icon-btn" onClick={onClose} aria-label={t('info.close')} data-testid="close-info">
          <Icon name="close" />
        </button>
        <h2 id="drawer-title">{group ? t('info.groupTitle') : t('info.title')}</h2>
      </header>
      <div className="panel-body">
        <section className="drawer-section">
          <button className="settings-row" onClick={onShared} data-testid="open-shared-content">
            <Icon name="image" /><span className="settings-row-text">{t('shared.title')}</span><Icon name="next" size={18} />
          </button>
        </section>
        {group ? <GroupInfo client={client} conversation={conversation} /> : <ContactInfo client={client} conversation={conversation} />}
      </div>
    </aside>
  );
}

function ContactInfo({ client, conversation }: { client: EnclaveClient; conversation: Conversation }) {
  const { t } = useI18n();
  const note = conversation.kind === 'note';
  const profile = useProfile(conversation.id);
  const account = useAccount(client, conversation.id);
  const title = note ? t('chats.noteToSelf') : conversation.title;
  return (
    <>
      <section className="drawer-section drawer-hero">
        <Avatar id={conversation.id} name={title} size={120} />
        <h3>{title}</h3>
        {account && <span className="muted-text">@{account.username}</span>}
      </section>
      {account?.phone && (
        <section className="drawer-section">
          <h4>{t('info.phone')}</h4>
          <span>{account.phone}</span>
        </section>
      )}
      {profile?.status && <section className="drawer-section"><h4>{t('profile.status')}</h4><p data-testid="contact-status">{profile.status}</p></section>}
      {!note && <SafetyNumber client={client} conversation={conversation} />}
    </>
  );
}

/** Safety number with verify/clear (specs §5.6). */
function SafetyNumber({ client, conversation }: { client: EnclaveClient; conversation: Conversation }) {
  const { t } = useI18n();
  const [digits, setDigits] = useState<string | null | undefined>(undefined);
  const [verified, setVerified] = useState(false);
  const [open, setOpen] = useState(Boolean(conversation.identityChangedAt));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const keys = await client.identityKeys(conversation.id);
      if (!keys.remote) {
        if (!cancelled) setDigits(null);
        return;
      }
      const number = await new FingerprintGenerator(FINGERPRINT_ITERATIONS).createFor(
        client.accountId,
        toArrayBuffer(fromBase64Url(keys.local)),
        conversation.id,
        toArrayBuffer(fromBase64Url(keys.remote)),
      );
      if (!cancelled) {
        setDigits(number);
        setVerified(keys.verified);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, conversation.id]);

  return (
    <section className="drawer-section" aria-labelledby="encryption-title">
      <h4 id="encryption-title">{t('info.encryption')}</h4>
      <p className="muted-text" style={{ margin: 0 }}>
        <Icon name="lock" size={14} /> {t('info.encryptionBody')}
      </p>
      {verified && (
        <p style={{ margin: 0, color: 'var(--c-accent-text)', fontWeight: 600 }}>
          <Icon name="shield" size={16} /> {t('safety.verified')}
        </p>
      )}
      {!open ? (
        <button className="btn" onClick={() => setOpen(true)} data-testid="open-safety">
          {t('info.verify')}
        </button>
      ) : digits === null ? (
        <p className="muted-text">{t('safety.unavailable')}</p>
      ) : (
        <>
          <p className="muted-text" style={{ margin: 0 }}>{t('safety.body', { name: conversation.title })}</p>
          <div className="code-box" aria-label={digits ?? ''} data-testid="safety-number">
            {(digits ?? '').match(/.{1,5}/g)?.map((group, i) => <span key={i}>{group}</span>)}
          </div>
          <button
            className={verified ? 'btn' : 'btn btn-primary'}
            disabled={!digits}
            onClick={() => {
              void client.setVerified(conversation.id, !verified).then(() => setVerified(!verified));
            }}
          >
            {verified ? t('safety.clear') : t('safety.markVerified')}
          </button>
        </>
      )}
    </section>
  );
}

interface MemberView {
  accountId: string;
  label: string;
  /** Real name for the avatar initials ("You" would render "Y"). */
  avatarName: string;
  username: string;
  role: GroupRole;
}

function GroupInfo({ client, conversation }: { client: EnclaveClient; conversation: Conversation }) {
  const { t } = useI18n();
  const record = useGroupRecord(client, conversation.id);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = useDirectorySearch(client, adding ? query : '');

  const load = useCallback(async () => {
    if (!record) return;
    const views = await Promise.all(
      record.members.map(async (m) => {
        const a = (await client.account(m.accountId)) ?? { accountId: m.accountId, username: '?' };
        return {
          accountId: m.accountId,
          role: m.role,
          username: a.username,
          avatarName: labelOf(a),
          label: m.accountId === client.accountId ? t('chats.you') : labelOf(a),
        };
      }),
    );
    views.sort((a, b) => (a.accountId === client.accountId ? -1 : b.accountId === client.accountId ? 1 : a.label.localeCompare(b.label)));
    setMembers(views);
  }, [client, record, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const myRole = members.find((m) => m.accountId === client.accountId)?.role ?? 'member';
  const canManage = myRole !== 'member' && !conversation.left;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      console.warn('Group change failed', e instanceof Error ? `${e.name}: ${e.message}` : e);
      setError(
        e instanceof GroupBusyError
          ? t('group.busy')
          : e instanceof MembersUnavailableError
            ? t('group.unavailable', { names: '' }).trim()
            : t('group.changeFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const add = (account: AccountDto) =>
    void run(async () => {
      await client.addGroupMembers(conversation.id, [account.accountId]);
      setAdding(false);
      setQuery('');
    });

  return (
    <>
      <section className="drawer-section drawer-hero">
        <Avatar id={conversation.id} name={conversation.title} size={120} group />
        <h3>{conversation.title}</h3>
        <span className="muted-text">{t('group.participants', { count: members.length })}</span>
      </section>
      <section className="drawer-section" aria-labelledby="members-title">
        <h4 id="members-title">{t('group.participants', { count: members.length })}</h4>
        {canManage && !adding && (
          <button className="row action" onClick={() => setAdding(true)} data-testid="add-member">
            <span className="action-icon">
              <Icon name="userPlus" />
            </span>
            <span className="row-main">
              <span className="row-title">{t('group.addParticipant')}</span>
            </span>
            <span />
          </button>
        )}
        {adding && (
          <div style={{ display: 'grid', gap: 8 }}>
            <label className="search">
              <Icon name="search" size={18} />
              <input autoFocus type="search" placeholder={t('newChat.searchNameOrNumber')} aria-label={t('newChat.searchNameOrNumber')}
                value={query} onChange={(e) => setQuery(e.target.value)} data-testid="people-search" />
              <button className="icon-btn" onClick={() => setAdding(false)} aria-label={t('thread.cancel')}>
                <Icon name="close" size={16} />
              </button>
            </label>
            <ul className="list">
              {results?.filter((a) => !members.some((m) => m.accountId === a.accountId)).map((a) => (
                <li key={a.accountId}>
                  <PersonRow account={a} onClick={() => !busy && add(a)} testId={`pick-${a.username}`} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="list" data-testid="group-members">
          {members.map((m) => (
            <li key={m.accountId} className="member-row" data-testid={`member-${m.username}`}>
              <Avatar id={m.accountId} name={m.avatarName} size={40} />
              <span className="name">
                <span style={{ display: 'block', fontWeight: 500 }}>{m.label}</span>
                <span className="muted-text">@{m.username}</span>
              </span>
              {m.role !== 'member' && <span className="role-tag">{t(`group.role.${m.role}`)}</span>}
              {canManage && m.accountId !== client.accountId && (m.role !== 'owner' || myRole === 'owner') && (
                <button className="btn btn-ghost btn-danger" disabled={busy}
                  onClick={() => {
                    if (window.confirm(t('group.confirmRemove', { name: m.label }))) void run(() => client.removeGroupMember(conversation.id, m.accountId));
                  }}>
                  {t('group.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="failed">{error}</p>}
      </section>
    </>
  );
}
