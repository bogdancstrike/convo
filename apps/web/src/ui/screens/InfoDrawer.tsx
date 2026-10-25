import { FormattedText } from '../components/FormattedText';
import { MAX_DESCRIPTION_BYTES } from '../../crypto/content';
import { utf8 } from '../../lib/bytes';
import { matches } from '../../lib/text';
import { CallLinkSection } from '../calls/CallLinks';
import { InviteSection } from './InviteSection';
import { LastSeen } from '../components/LastSeen';
import { SharedPreview, ConversationActions } from './ConversationDetails';
import { Menu } from '../components/Popover';
import { useProfile } from '../components/ProfileContext';
import { safetyNumber } from '../../crypto/safetyNumber';
import type { KtAccountRecord } from '../../core/ktMonitor';
import { useCallback, useEffect, useState } from 'react';
import type { AccountDto, GroupRole } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import { GroupBusyError, MembersUnavailableError } from '../../core/groups';
import { labelOf, type Conversation } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useAccount, useGroupRecord } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { PersonRow, useDirectorySearch, useRecentContacts } from './NewChatPanel';
import { SlowModeSection } from './MemberPolicy';
import { GuestBadge } from '../components/GuestBadge';

/**
 * Right-hand info drawer (UI.md §4.3, §5.4a): contact details with safety-number verification, or
 * group details with members, roles and admin add/remove.
 */
export function InfoDrawer({ client, conversation, onClose, onShared, onPage, onContact, onOpenChat }: { client: EnclaveClient; conversation: Conversation; onClose: () => void; onShared: () => void; onPage: (page: string) => void; onContact: (accountId: string) => void; onOpenChat?: (id: string) => void }) {
  const { t } = useI18n();
  const group = conversation.kind === 'group';
  return (
    <aside className="drawer" aria-labelledby="drawer-title" data-testid="info-drawer">
      <header className="panel-header sub" style={{ background: 'var(--c-panel)' }}>
        <button className="icon-btn" onClick={onClose} aria-label={t('info.close')} data-testid="close-info">
          <Icon name="close" />
        </button>
        <h2 id="drawer-title">{group ? t(conversation.adminOnly ? 'info.channelTitle' : 'info.groupTitle') : t('info.title')}</h2>
      </header>
      <div className="panel-body">
        {group ? <GroupInfo client={client} conversation={conversation} onContact={onContact} /> : <ContactInfo client={client} conversation={conversation} />}
        {conversation.kind === 'direct' && onOpenChat && <CommonGroups client={client} accountId={conversation.id} onOpen={onOpenChat} />}
        <SharedPreview client={client} conversation={conversation} onOpen={onShared} />
        <ConversationActions client={client} conversation={conversation} onClose={onClose} onPage={onPage} />
      </div>
    </aside>
  );
}

export function ContactInfo({ client, conversation }: { client: EnclaveClient; conversation: Conversation }) {
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
        {account && <span className="muted-text">@{account.username} <GuestBadge account={account} /></span>}
        {!note && <LastSeen client={client} accountId={conversation.id} />}
      </section>
      {account?.phone && (
        <section className="drawer-section">
          <h4>{t('info.phone')}</h4>
          <span>{account.phone}</span>
        </section>
      )}
      {profile?.status && <section className="drawer-section"><h4>{t('profile.status')}</h4><p data-testid="contact-status">{profile.status}</p></section>}
      {!note && <SafetyNumber client={client} conversation={conversation} />}
      {!note && <KeyTransparency client={client} accountId={conversation.id} />}
    </>
  );
}

/**
 * Key transparency (specs §19.4): whether this contact's keys match the public key log. Checked
 * again whenever the drawer opens; mismatch and log errors are shown as warnings.
 */
function KeyTransparency({ client, accountId }: { client: EnclaveClient; accountId: string }) {
  const { t } = useI18n();
  const [record, setRecord] = useState<KtAccountRecord | undefined | null>(null);
  useEffect(() => {
    let cancelled = false;
    void client.keyTransparency(accountId, true).then((r) => { if (!cancelled) setRecord(r); }).catch(() => { if (!cancelled) setRecord(undefined); });
    const off = client.on('keyTransparency', (e) => { if (e.accountId === accountId) setRecord(e.record); });
    return () => { cancelled = true; off(); };
  }, [client, accountId]);
  if (record === null) return null;
  const status = record?.status ?? 'unknown';
  const warning = status === 'mismatch' || status === 'log-error';
  return (
    <section className="drawer-section" data-testid="kt-status" data-status={status}>
      <h4>{t('kt.title')}</h4>
      <p style={{ margin: 0, fontWeight: 600, color: warning ? 'var(--c-danger-text)' : status === 'verified' ? 'var(--c-accent-text)' : undefined }}>
        <Icon name={warning ? 'alert' : 'shield'} size={16} /> {t(`kt.${status}`)}
      </p>
      <p className="muted-text" style={{ margin: 0 }}>{t(`kt.${status}Body`)}</p>
    </section>
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
    let generation = 0;
    let previousKeys = '';
    const load = async () => {
      const current = ++generation;
      const keys = await client.identityKeys(conversation.id);
      if (cancelled || current !== generation) return;
      if (!keys.remote) {
        setDigits(null);
        return;
      }
      setVerified(keys.verified);
      const keyPair = `${keys.local}/${keys.remote}`;
      if (keyPair === previousKeys) return;
      const number = safetyNumber(client.accountId, keys.local, conversation.id, keys.remote);
      if (!cancelled && current === generation) {
        previousKeys = keyPair;
        setDigits(number);
        setVerified(keys.verified);
      }
    };
    const refresh = () => void load().catch(() => { if (!cancelled) setDigits(null); });
    const off = client.on('messages', (id) => { if (id === conversation.id) refresh(); });
    refresh();
    return () => {
      cancelled = true;
      off();
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
  /** Guest accounts: when access ends. */
  guestUntil?: string;
}

function GroupInfo({ client, conversation, onContact }: { client: EnclaveClient; conversation: Conversation; onContact: (id: string) => void }) {
  const { t } = useI18n();
  const record = useGroupRecord(client, conversation.id);
  const [members, setMembers] = useState<MemberView[]>([]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = useDirectorySearch(client, adding ? query : '');
  const recent = useRecentContacts(client);
  const choices = (query.trim() ? results ?? [] : recent).filter((a) => !record?.members.some((m) => m.accountId === a.accountId));

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
          guestUntil: a.guestUntil,
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
  // Member search (specs §30.8): local roster only, diacritic/case-insensitive; Admins includes owners.
  const [memberQuery, setMemberQuery] = useState('');
  const [adminsOnly, setAdminsOnly] = useState(false);
  const shown = members.filter((m) => (!adminsOnly || m.role !== 'member') && matches(memberQuery, m.label, m.username));
  const canManage = myRole !== 'member' && !conversation.left && !record?.needsJoin;
  const restricted = conversation.memberPolicy?.restricted ?? [];

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
        <span className="chat-kind" data-testid="conversation-kind"><Icon name={conversation.adminOnly ? 'channels' : 'group'} size={16} />{t(conversation.adminOnly ? 'channel.type' : 'group.type')}</span>
        <span className="muted-text">{t('group.participants', { count: members.length })}</span>
      </section>
      <GroupAbout client={client} conversation={conversation} description={record?.description} canEdit={canManage} />
      {canManage && <InviteSection client={client} conversation={conversation} />}
      {!conversation.adminOnly && !conversation.left && client.policy.features.callLinks && <CallLinkSection client={client} conversation={conversation} />}
      {canManage && !conversation.adminOnly && <SlowModeSection client={client} conversation={conversation} onError={setError} />}
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
            {!query.trim() && <span className="section-label">{t('group.recentContacts')}</span>}
            {!query.trim() && choices.length === 0 && <p className="muted-text">{t('group.noRecentContacts')}</p>}
            {query.trim() && results?.length === 0 && <p className="muted-text">{t('newChat.none')}</p>}
            <ul className="list contact-suggestions" aria-label={t('group.recentContacts')} data-testid="member-suggestions">
              {choices.map((a) => (
                <li key={a.accountId}>
                  <PersonRow account={a} onClick={() => !busy && add(a)} testId={`pick-${a.username}`} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {members.length > 1 && (
          <div className="member-search">
            <label className="search">
              <Icon name="search" size={16} />
              <input type="search" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder={t('group.searchMembers')}
                aria-label={t('group.searchMembers')} data-testid="member-search" />
            </label>
            <div className="chips" role="group" aria-label={t('group.memberFilter')}>
              <button className="chip" aria-pressed={!adminsOnly} onClick={() => setAdminsOnly(false)} data-testid="member-filter-all">{t('group.filterAll')}</button>
              <button className="chip" aria-pressed={adminsOnly} onClick={() => setAdminsOnly(true)} data-testid="member-filter-admins">{t('group.filterAdmins')}</button>
            </div>
            <p className="muted-text" role="status" aria-live="polite" data-testid="member-count">{t('group.shownCount', { shown: shown.length, total: members.length })}</p>
          </div>
        )}
        <ul className="list" data-testid="group-members">
          {shown.map((m) => (
            <li key={m.accountId} className="member-row" data-testid={`member-${m.username}`}>
              <Avatar id={m.accountId} name={m.avatarName} size={40} />
              <button className="name" onClick={() => onContact(m.accountId)} data-testid={`contact-${m.username}`}>
                <span style={{ display: 'block', fontWeight: 500 }}>{m.label}</span>
                <span className="muted-text">@{m.username}</span>
              </button>
              {m.role !== 'member' && <span className="role-tag">{t(`group.role.${m.role}`)}</span>}
              <GuestBadge account={m} />
              {m.role === 'member' && restricted.includes(m.accountId) && <span className="role-tag" data-testid={`restricted-${m.username}`}>{t('slow.restrictedTag')}</span>}
              {canManage && m.accountId !== client.accountId && (m.role !== 'owner' || myRole === 'owner') && (
                <Menu label={t('group.memberOptions')} items={[
                  ...(myRole === 'owner' && m.role !== 'owner' ? [{ label: t(m.role === 'admin' ? 'group.removeAdmin' : 'group.makeAdmin'), icon: 'shield' as const, onSelect: () => void run(() => client.changeGroupRole(conversation.id, m.accountId, m.role === 'admin' ? 'member' : 'admin')) },
                    { label: t('group.makeOwner'), icon: 'shield' as const, onSelect: () => { if (window.confirm(t('group.confirmOwner', { name: m.label }))) void run(() => client.changeGroupRole(conversation.id, m.accountId, 'owner')); } }] : []),
                  ...(myRole === 'owner' && m.role === 'owner' ? [{ label: t('group.removeOwner'), icon: 'shield' as const, onSelect: () => void run(() => client.changeGroupRole(conversation.id, m.accountId, 'admin')) }] : []),
                  ...(m.role === 'member' && !conversation.adminOnly ? [{ label: t(restricted.includes(m.accountId) ? 'slow.allow' : 'slow.restrict'), icon: 'lock' as const, testId: 'member-restrict',
                    onSelect: () => void run(() => client.setMemberPolicy(conversation.id, { restricted: restricted.includes(m.accountId) ? restricted.filter((id) => id !== m.accountId) : [...restricted, m.accountId] })) }] : []),
                  { label: t('group.remove'), icon: 'trash', danger: true, onSelect: () => { if (window.confirm(t('group.confirmRemove', { name: m.label }))) void run(() => client.removeGroupMember(conversation.id, m.accountId)); } },
                  { label: t('group.ban'), icon: 'trash', danger: true, testId: 'member-ban', onSelect: () => { if (window.confirm(t('group.confirmBan', { name: m.label }))) void run(() => client.banMember(conversation.id, m.accountId)); } },
                ]} trigger={({ open, toggle }) => <button className="icon-btn" disabled={busy} onClick={toggle} aria-label={`${t('group.memberOptions')}: ${m.label}`} aria-expanded={open} data-testid={`member-menu-${m.username}`}><Icon name="more" /></button>} />
              )}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="failed">{error}</p>}
      </section>
    </>
  );
}

/**
 * Groups in common (specs §30.8): local intersection of this account's active groups and their
 * rosters; nothing is uploaded and groups this device cannot see are never enumerated.
 */
export function CommonGroups({ client, accountId, onOpen }: { client: EnclaveClient; accountId: string; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [common, setCommon] = useState<Conversation[]>([]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(client.conversations().filter((c) => c.kind === 'group' && !c.left).map(async (c) => {
      const record = await client.groupRecord(c.id);
      return record?.members.some((m) => m.accountId === accountId) && record.members.some((m) => m.accountId === client.accountId) ? c : null;
    })).then((groups) => { if (!cancelled) setCommon(groups.filter((c): c is Conversation => Boolean(c))); });
    return () => { cancelled = true; };
  }, [client, accountId]);
  return (
    <section className="drawer-section" data-testid="common-groups">
      <h4>{t('info.commonGroups', { count: common.length })}</h4>
      {common.map((group) => <button className="settings-row" key={group.id} onClick={() => onOpen(group.id)} data-testid="common-group">
        <Avatar id={group.id} name={group.title} size={40} group /><span className="settings-row-text">{group.title}</span><Icon name="next" size={18} /></button>)}
    </section>
  );
}

/**
 * Group About (specs §30.8): E2EE description shown with the safe message formatting (no HTML,
 * links visible before opening). Owners/admins edit name and description (≤ 8 KiB).
 */
function GroupAbout({ client, conversation, description, canEdit }: { client: EnclaveClient; conversation: Conversation; description?: string; canEdit: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(conversation.title);
  const [text, setText] = useState(description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const bytes = utf8(text).length;
  if (!editing) {
    if (!description && !canEdit) return null;
    return (
      <section className="drawer-section" data-testid="group-about">
        <h4>{t('group.about')}</h4>
        {description ? <p className="group-description" data-testid="group-description"><FormattedText text={description} /></p>
          : <p className="muted-text">{t('group.noDescription')}</p>}
        {canEdit && <button className="btn btn-ghost" onClick={() => { setName(conversation.title); setText(description ?? ''); setEditing(true); }} data-testid="edit-group-info">{t('group.editInfo')}</button>}
      </section>
    );
  }
  return (
    <form className="drawer-section group-about-form" data-testid="group-about-form" onSubmit={(e) => {
      e.preventDefault(); setBusy(true); setError(false);
      void client.updateGroupInfo(conversation.id, { name, description: text }).then(() => setEditing(false)).catch(() => setError(true)).finally(() => setBusy(false));
    }}>
      <label className="field"><span>{t('group.subject')}</span>
        <input className="underline-input" maxLength={128} value={name} onChange={(e) => setName(e.target.value)} data-testid="group-name-edit" /></label>
      <label className="field"><span>{t('group.about')}</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-describedby="about-help" data-testid="group-description-edit" /></label>
      <p id="about-help" className={`muted-text${bytes > MAX_DESCRIPTION_BYTES ? ' failed' : ''}`}>{t('group.aboutHelp', { used: bytes, max: MAX_DESCRIPTION_BYTES })}</p>
      {error && <p role="alert" className="failed">{t('group.changeFailed')}</p>}
      <div className="lock-actions">
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim() || bytes > MAX_DESCRIPTION_BYTES} data-testid="save-group-info">{t('storeLock.save')}</button>
        <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>{t('storeLock.cancel')}</button>
      </div>
    </form>
  );
}
