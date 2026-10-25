import { useCallback, useEffect, useState } from 'react';
import type { CommunityGroup, CommunityView, EnclaveClient, OnboardingView } from '../../core/client';
import { OnboardingEditor, WelcomeCard } from './Onboarding';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/**
 * Communities (COM-01/02, specs §30.3): a community is an announcement channel plus linked groups.
 * Joining a community means joining its announcement channel (invite link + approval); groups are
 * joined one by one (ask to join → a group admin approves). Names and descriptions are E2EE.
 *
 * `page`: null = list, `new` = create, otherwise a community ID.
 */
export function CommunitiesPanel({ client, page, onNavigate, onOpenChat }: {
  client: EnclaveClient;
  page: string | null;
  onNavigate: (page: string | null) => void;
  onOpenChat: (conversationId: string, info?: boolean) => void;
}) {
  const [communities, setCommunities] = useState<CommunityView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => void client.communities().then((c) => { setCommunities(c); setFailed(false); }).catch(() => setFailed(true)), [client]);
  useEffect(() => { load(); return client.on('groups', load); }, [client, load]);

  if (page === 'new') return <NewCommunity client={client} onBack={() => onNavigate(null)} onCreated={(c) => { load(); onNavigate(c.communityId); }} />;
  const current = page ? communities?.find((c) => c.communityId === page) : undefined;
  if (page && current) return <CommunityDetail client={client} community={current} onBack={() => onNavigate(null)} onOpenChat={onOpenChat} />;
  return <CommunityList communities={communities} failed={failed} onNew={() => onNavigate('new')} onOpen={(c) => onNavigate(c.communityId)} />;
}

function CommunityList({ communities, failed, onNew, onOpen }: { communities: CommunityView[] | null; failed: boolean; onNew: () => void; onOpen: (c: CommunityView) => void }) {
  const { t } = useI18n();
  return (
    <>
      <header className="panel-header"><h2>{t('community.title')}</h2></header>
      <div className="panel-body">
        <ul className="list">
          <li>
            <button className="row action" onClick={onNew} data-testid="new-community">
              <span className="action-icon"><Icon name="plus" /></span>
              <span className="row-main"><span className="row-title">{t('community.new')}</span></span>
            </button>
          </li>
          {(communities ?? []).map((c) => (
            <li key={c.communityId}>
              <button className="row" onClick={() => onOpen(c)} data-testid="community-row">
                <Avatar id={c.conversationId} name={c.name || '?'} size={44} group />
                <span className="row-main">
                  <span className="row-title">{c.name || t('community.unnamed')}</span>
                  <span className="row-preview">{c.description || t(`community.role.${c.role}`)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {communities?.length === 0 && <div className="empty"><Icon name="community" size={44} /><h3>{t('community.emptyTitle')}</h3><p>{t('community.emptyBody')}</p></div>}
        {failed && <p role="alert" className="failed">{t('community.loadFailed')}</p>}
      </div>
    </>
  );
}

function NewCommunity({ client, onBack, onCreated }: { client: EnclaveClient; onBack: () => void; onCreated: (c: CommunityView) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <header className="panel-header sub">
        <button className="icon-btn" onClick={onBack} aria-label={t('thread.back')}><Icon name="back" /></button>
        <h2>{t('community.new')}</h2>
      </header>
      <form className="panel-body community-form" onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true); setError(false);
        void client.createCommunity(name, description).then(onCreated).catch(() => { setError(true); setBusy(false); });
      }}>
        <label className="field">
          <span>{t('community.name')}</span>
          <input className="underline-input" autoFocus maxLength={128} value={name} data-testid="community-name"
            onChange={(e) => setName(e.target.value.replace(/[\u0000-\u001f\u007f]/g, ''))} />
        </label>
        <label className="field">
          <span>{t('community.description')}</span>
          <textarea className="underline-input" maxLength={1000} rows={3} value={description} data-testid="community-description"
            onChange={(e) => setDescription(e.target.value)} />
        </label>
        <p className="muted-text">{t('community.createHelp')}</p>
        {error && <p role="alert" className="failed">{t('community.createFailed')}</p>}
        <button className="btn btn-primary" type="submit" disabled={!name.trim() || busy} data-testid="create-community">{t('community.create')}</button>
      </form>
    </>
  );
}

function CommunityDetail({ client, community, onBack, onOpenChat }: {
  client: EnclaveClient; community: CommunityView; onBack: () => void; onOpenChat: (id: string, info?: boolean) => void;
}) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<CommunityGroup[] | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingView | undefined>();
  const [operations, setOperations] = useState<{ groupId: string; name: string; status: 'pending' | 'completed' | 'blocked' }[]>([]);
  const [follow, setFollow] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const manager = community.role === 'owner' || community.role === 'admin';
  // Re-render when secure group state arrives: a group the server lists as joined opens only
  // once this device has processed its MLS welcome.
  const [, setVersion] = useState(0);
  useEffect(() => client.on('conversations', () => setVersion((v) => v + 1)), [client]);
  const ready = (conversationId: string) => !!client.conversation(conversationId);
  const load = useCallback(() => {
    void client.communityGroups(community).then(setGroups).catch(() => setError(t('community.loadFailed')));
    void client.onboarding(community).then(setOnboarding).catch(() => undefined);
    if (community.role === 'owner' || community.role === 'admin') void client.communityOperations(community).then(setOperations).catch(() => undefined);
  }, [client, community, t]);
  const askToJoin = (groupId: string) => { setError(null); void client.requestCommunityGroup(community, groupId).then(() => setRequested((r) => new Set(r).add(groupId))).catch(() => setError(t('community.actionFailed'))); };
  useEffect(() => { load(); return client.on('groups', load); }, [client, load]);
  const act = (work: Promise<unknown>) => { setError(null); void work.then(load).catch(() => setError(t('community.actionFailed'))); };

  const [creating, setCreating] = useState(false);
  const active = (groups ?? []).filter((g) => g.status === 'active');
  const joined = active.filter((g) => g.member).length;

  return (
    <>
      <header className="panel-header sub">
        <button className="icon-btn" onClick={onBack} aria-label={t('thread.back')}><Icon name="back" /></button>
        <h2 data-testid="community-title">{community.name || t('community.unnamed')}</h2>
      </header>
      <div className="panel-body community-detail">
        <section className="community-hero">
          <Avatar id={community.conversationId} name={community.name || '?'} size={72} group />
          <div className="community-hero-text">
            <p className="community-hero-name">{community.name || t('community.unnamed')}</p>
            <p className="muted-text">{t('community.summary', { groups: active.length, joined })}{manager ? ` · ${t(community.role === 'owner' ? 'community.youOwner' : 'community.youAdmin')}` : ''}</p>
            {community.description && <p className="community-description" data-testid="community-about">{community.description}</p>}
          </div>
        </section>
        {onboarding && !editing && <WelcomeCard client={client} community={community} view={onboarding} groups={groups ?? []} onAskToJoin={askToJoin} />}
        {manager && editing && <OnboardingEditor client={client} community={community} view={onboarding} groups={groups ?? []} onClose={() => { setEditing(false); load(); }} />}

        <button className="community-announcements-card" disabled={!ready(community.conversationId)} onClick={() => onOpenChat(community.conversationId)} data-testid="community-announcements">
          <span className="action-icon"><Icon name="channels" /></span>
          <span className="row-main"><span className="row-title">{t('community.announcements')}</span>
            <span className="community-wrap">{t(manager ? 'community.announcementsAdmin' : 'community.announcementsMember')}</span></span>
          <Icon name="next" size={18} />
        </button>
        {manager && !editing && (
          <div className="community-tools">
            <button className="community-tool" onClick={() => setEditing(true)} data-testid="edit-onboarding">
              <Icon name="note" size={20} /><span className="row-title">{t('onboarding.edit')}</span><span className="community-wrap muted-text">{t('onboarding.editHelp')}</span>
            </button>
            <button className="community-tool" onClick={() => onOpenChat(community.conversationId, true)} data-testid="community-invite">
              <Icon name="link" size={20} /><span className="row-title">{t('community.invite')}</span><span className="community-wrap muted-text">{t('community.inviteHelp')}</span>
            </button>
          </div>
        )}

        <div className="community-section-head">
          <h3 className="section-title">{t('community.groups')}</h3>
          {manager && !creating && !adding && (
            <span className="community-section-actions">
              <button className="btn btn-primary" onClick={() => setCreating(true)} data-testid="community-new-group"><Icon name="plus" size={16} /> {t('community.newGroup')}</button>
              <button className="btn btn-ghost" onClick={() => setAdding(true)} data-testid="community-add-group">{t('community.addGroup')}</button>
            </span>
          )}
        </div>
        {manager && creating && <NewCommunityGroup client={client} community={community}
          onDone={(created) => { setCreating(false); load(); if (created) onOpenChat(created); }} onError={() => setError(t('community.createGroupFailed'))} />}
        {manager && adding && <AddGroup client={client} community={community} linked={new Set((groups ?? []).map((g) => g.conversationId))}
          onDone={() => { setAdding(false); load(); }} onError={() => setError(t('community.linkFailed'))} />}
        <ul className="list community-groups" data-testid="community-groups">
          {(groups ?? []).map((g) => { const open = g.member && ready(g.conversationId); return (
            <li key={g.groupId} className="community-group" data-testid="community-group" data-status={g.status} data-member={open}>
              <button className="row" disabled={!open} onClick={() => open && onOpenChat(g.conversationId)}>
                <Avatar id={g.conversationId} name={g.name ?? '?'} size={40} group />
                <span className="row-main">
                  <span className="row-title">{g.name ?? t('community.privateGroup')}</span>
                  <span className="row-preview">{g.status === 'proposed' ? t(g.canAccept ? 'community.proposedToYou' : 'community.waitingOwner')
                    : open ? t('community.joined') : g.member ? t('community.joining') : t(g.visibility === 'private' ? 'community.private' : 'community.discoverable')}
                    {g.status === 'active' && g.delegation && <span data-testid="community-delegation"> · {t('community.followsRemoval')}</span>}</span>
                </span>
              </button>
              <span className="community-group-actions">
                {g.canAccept && <label className="muted-text"><input type="checkbox" checked={follow[g.groupId] ?? true} onChange={(e) => setFollow((f) => ({ ...f, [g.groupId]: e.target.checked }))} data-testid="community-accept-delegation" /> {t('community.delegationShort')}</label>}
                {g.canAccept && <button className="btn btn-primary" onClick={() => act(client.acceptCommunityLink(community, g.groupId, follow[g.groupId] ?? true))} data-testid="community-accept">{t('community.accept')}</button>}
                {g.status === 'active' && !g.member && g.visibility === 'discoverable' && (requested.has(g.groupId)
                  ? <span className="muted-text" data-testid="community-requested">{t('community.requested')}</span>
                  : <button className="btn btn-primary" data-testid="community-join" onClick={() => askToJoin(g.groupId)}>{t('community.askToJoin')}</button>)}
                {(manager || g.canAccept) && <button className="btn btn-ghost" onClick={() => act(client.unlinkCommunityGroup(community, g.groupId))} data-testid="community-unlink">{t('community.unlink')}</button>}
              </span>
            </li>
          ); })}
        </ul>
        {groups?.length === 0 && !creating && !adding && (
          <div className="community-empty">
            <Icon name="group" size={28} />
            <p>{t(manager ? 'community.noGroupsAdmin' : 'community.noGroups')}</p>
          </div>
        )}
        {manager && operations.filter((o) => o.status !== 'completed').length > 0 && (
          <div className="community-ops" data-testid="community-operations">
            <h3 className="section-title">{t('community.operations')}</h3>
            <ul className="list">
              {operations.filter((o) => o.status !== 'completed').map((o) => {
                const label = groups?.find((g) => g.groupId === o.groupId)?.name ?? t('community.privateGroup');
                return <li key={`${o.groupId}:${o.name}`} className="settings-row" data-testid="community-operation" data-status={o.status}>
                  <span className="settings-row-text">{t(o.status === 'pending' ? 'community.opPending' : 'community.opBlocked', { name: o.name, group: label })}</span></li>;
              })}
            </ul>
            {operations.some((o) => o.status === 'blocked') && <>
              <p className="muted-text">{t('community.opBlockedHelp')}</p>
              <button className="btn" onClick={() => act(client.retryCommunityOperations(community))} data-testid="community-ops-retry">{t('community.opRetry')}</button>
            </>}
          </div>
        )}
        {error && <p role="alert" className="failed" data-testid="community-error">{error}</p>}
      </div>
    </>
  );
}

/** Who can find a community group, and whether community removal also removes people from it. */
function GroupOptions({ visibility, setVisibility, delegation, setDelegation }: {
  visibility: 'discoverable' | 'private'; setVisibility: (v: 'discoverable' | 'private') => void; delegation: boolean; setDelegation: (d: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <fieldset className="community-visibility">
        <legend>{t('community.visibility')}</legend>
        {(['discoverable', 'private'] as const).map((v) => (
          <label key={v} className="community-option" data-selected={visibility === v}>
            <input type="radio" name="visibility" checked={visibility === v} onChange={() => setVisibility(v)} data-testid={`community-visibility-${v}`} />
            <span><span className="row-title">{t(`community.${v}Title`)}</span><span className="community-wrap muted-text">{t(`community.${v}Help`)}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="community-option" data-selected={delegation}>
        <input type="checkbox" checked={delegation} onChange={(e) => setDelegation(e.target.checked)} data-testid="community-delegation-toggle" />
        <span><span className="row-title">{t('community.delegationTitle')}</span><span className="community-wrap muted-text">{t('community.delegationHelp')}</span></span>
      </label>
    </>
  );
}

/**
 * Creates a group inside the community (WhatsApp-style): name, optional description, people from
 * the community, who can find it. The creator owns both, so the group is part of the community at once.
 */
function NewCommunityGroup({ client, community, onDone, onError }: {
  client: EnclaveClient; community: CommunityView; onDone: (created?: string) => void; onError: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<{ accountId: string; name: string }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [visibility, setVisibility] = useState<'discoverable' | 'private'>('discoverable');
  const [delegation, setDelegation] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void client.communityMembers(community).then(setMembers).catch(() => setMembers([])); }, [client, community]);
  const shown = (members ?? []).filter((m) => m.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const create = () => {
    setBusy(true);
    void client.createCommunityGroup(community, { name, description, memberIds: [...picked], visibility, delegation })
      .then((c) => onDone(c.id)).catch(() => { setBusy(false); onError(); });
  };
  return (
    <div className="community-card" data-testid="community-create-group">
      <h4>{t('community.newGroupTitle')}</h4>
      <label className="community-field">{t('community.groupName')}
        <input className="underline-input" autoFocus maxLength={128} value={name} onChange={(e) => setName(e.target.value)} data-testid="community-group-name" />
      </label>
      <label className="community-field">{t('community.groupDescription')}
        <textarea className="underline-input" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="community-group-description" />
      </label>
      <div className="community-field">
        <span>{t('community.groupMembers', { count: picked.size })}</span>
        {(members?.length ?? 0) > 6 && <input className="underline-input" type="search" placeholder={t('community.searchMembers')} value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="community-member-search" />}
        <ul className="community-member-picker">
          {shown.map((m) => (
            <li key={m.accountId}>
              <label data-selected={picked.has(m.accountId)}>
                <input type="checkbox" checked={picked.has(m.accountId)} onChange={() => toggle(m.accountId)} data-testid="community-member-pick" />
                <Avatar id={m.accountId} name={m.name} size={28} /> <span>{m.name}</span>
              </label>
            </li>
          ))}
        </ul>
        {members?.length === 0 && <p className="muted-text">{t('community.noOtherMembers')}</p>}
      </div>
      <GroupOptions visibility={visibility} setVisibility={setVisibility} delegation={delegation} setDelegation={setDelegation} />
      <div className="community-card-actions">
        <button className="btn btn-ghost" onClick={() => onDone()} disabled={busy}>{t('storeLock.cancel')}</button>
        <button className="btn btn-primary" onClick={create} disabled={busy || !name.trim()} data-testid="community-create-group-submit">{busy ? t('community.creating') : t('community.createGroup')}</button>
      </div>
    </div>
  );
}

/** Picks one of this account's groups to link (owner of it: active at once; otherwise its owner accepts). */
function AddGroup({ client, community, linked, onDone, onError }: {
  client: EnclaveClient; community: CommunityView; linked: Set<string>; onDone: () => void; onError: () => void;
}) {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<'discoverable' | 'private'>('discoverable');
  const [delegation, setDelegation] = useState(true);
  const candidates = client.conversations().filter((c) => c.kind === 'group' && !c.left && c.id !== community.conversationId && !linked.has(c.id));
  return (
    <div className="community-card community-add" data-testid="community-add">
      <h4>{t('community.addGroupTitle')}</h4>
      <GroupOptions visibility={visibility} setVisibility={setVisibility} delegation={delegation} setDelegation={setDelegation} />
      <ul className="list">
        {candidates.map((c) => (
          <li key={c.id}>
            <button className="row" data-testid="community-pick-group" onClick={() => void client.linkGroupToCommunity(community, c.id, visibility, delegation).then(onDone).catch(onError)}>
              <Avatar id={c.id} name={c.title} size={36} group />
              <span className="row-main"><span className="row-title">{c.title}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {candidates.length === 0 && <p className="muted-text">{t('community.noCandidates')}</p>}
      <div className="community-card-actions"><button className="btn btn-ghost" onClick={onDone}>{t('storeLock.cancel')}</button></div>
    </div>
  );
}
