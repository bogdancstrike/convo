import { useCallback, useEffect, useState } from 'react';
import type { CommunityGroup, CommunityView, EnclaveClient } from '../../core/client';
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
  const [error, setError] = useState<string | null>(null);
  const manager = community.role === 'owner' || community.role === 'admin';
  // Re-render when secure group state arrives: a group the server lists as joined opens only
  // once this device has processed its MLS welcome.
  const [, setVersion] = useState(0);
  useEffect(() => client.on('conversations', () => setVersion((v) => v + 1)), [client]);
  const ready = (conversationId: string) => !!client.conversation(conversationId);
  const load = useCallback(() => void client.communityGroups(community).then(setGroups).catch(() => setError(t('community.loadFailed'))), [client, community, t]);
  useEffect(() => { load(); return client.on('groups', load); }, [client, load]);
  const act = (work: Promise<unknown>) => { setError(null); void work.then(load).catch(() => setError(t('community.actionFailed'))); };

  return (
    <>
      <header className="panel-header sub">
        <button className="icon-btn" onClick={onBack} aria-label={t('thread.back')}><Icon name="back" /></button>
        <h2 data-testid="community-title">{community.name || t('community.unnamed')}</h2>
      </header>
      <div className="panel-body">
        {community.description && <p className="community-description" data-testid="community-about">{community.description}</p>}
        <ul className="list">
          <li>
            <button className="row" disabled={!ready(community.conversationId)} onClick={() => onOpenChat(community.conversationId)} data-testid="community-announcements">
              <span className="action-icon"><Icon name="channels" /></span>
              <span className="row-main"><span className="row-title">{t('community.announcements')}</span>
                <span className="row-preview">{t(manager ? 'community.announcementsAdmin' : 'community.announcementsMember')}</span></span>
            </button>
          </li>
          {manager && (
            <li>
              <button className="row action" onClick={() => onOpenChat(community.conversationId, true)} data-testid="community-invite">
                <span className="action-icon"><Icon name="link" /></span>
                <span className="row-main"><span className="row-title">{t('community.invite')}</span>
                  <span className="row-preview">{t('community.inviteHelp')}</span></span>
              </button>
            </li>
          )}
        </ul>
        <h3 className="section-title">{t('community.groups')}</h3>
        <ul className="list" data-testid="community-groups">
          {(groups ?? []).map((g) => { const open = g.member && ready(g.conversationId); return (
            <li key={g.groupId} className="community-group" data-testid="community-group" data-status={g.status} data-member={open}>
              <button className="row" disabled={!open} onClick={() => open && onOpenChat(g.conversationId)}>
                <Avatar id={g.conversationId} name={g.name ?? '?'} size={40} group />
                <span className="row-main">
                  <span className="row-title">{g.name ?? t('community.privateGroup')}</span>
                  <span className="row-preview">{g.status === 'proposed' ? t(g.canAccept ? 'community.proposedToYou' : 'community.waitingOwner')
                    : open ? t('community.joined') : g.member ? t('community.joining') : t(g.visibility === 'private' ? 'community.private' : 'community.discoverable')}</span>
                </span>
              </button>
              <span className="community-group-actions">
                {g.canAccept && <button className="btn btn-primary" onClick={() => act(client.acceptCommunityLink(community, g.groupId))} data-testid="community-accept">{t('community.accept')}</button>}
                {g.status === 'active' && !g.member && g.visibility === 'discoverable' && (requested.has(g.groupId)
                  ? <span className="muted-text" data-testid="community-requested">{t('community.requested')}</span>
                  : <button className="btn btn-primary" data-testid="community-join" onClick={() => {
                    setError(null);
                    void client.requestCommunityGroup(community, g.groupId).then(() => setRequested((r) => new Set(r).add(g.groupId))).catch(() => setError(t('community.actionFailed')));
                  }}>{t('community.askToJoin')}</button>)}
                {(manager || g.canAccept) && <button className="btn btn-ghost" onClick={() => act(client.unlinkCommunityGroup(community, g.groupId))} data-testid="community-unlink">{t('community.unlink')}</button>}
              </span>
            </li>
          ); })}
        </ul>
        {groups?.length === 0 && <p className="muted-text">{t(manager ? 'community.noGroupsAdmin' : 'community.noGroups')}</p>}
        {manager && !adding && <button className="btn" onClick={() => setAdding(true)} data-testid="community-add-group"><Icon name="plus" size={16} /> {t('community.addGroup')}</button>}
        {manager && adding && <AddGroup client={client} community={community} linked={new Set((groups ?? []).map((g) => g.conversationId))}
          onDone={() => { setAdding(false); load(); }} onError={() => setError(t('community.linkFailed'))} />}
        {error && <p role="alert" className="failed" data-testid="community-error">{error}</p>}
      </div>
    </>
  );
}

/** Picks one of this account's groups to link (owner of it: active at once; otherwise its owner accepts). */
function AddGroup({ client, community, linked, onDone, onError }: {
  client: EnclaveClient; community: CommunityView; linked: Set<string>; onDone: () => void; onError: () => void;
}) {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<'discoverable' | 'private'>('discoverable');
  const candidates = client.conversations().filter((c) => c.kind === 'group' && !c.left && c.id !== community.conversationId && !linked.has(c.id));
  return (
    <div className="community-add" data-testid="community-add">
      <fieldset className="community-visibility">
        <legend>{t('community.visibility')}</legend>
        {(['discoverable', 'private'] as const).map((v) => (
          <label key={v}><input type="radio" name="visibility" checked={visibility === v} onChange={() => setVisibility(v)} data-testid={`community-visibility-${v}`} /> {t(`community.${v}Help`)}</label>
        ))}
      </fieldset>
      <ul className="list">
        {candidates.map((c) => (
          <li key={c.id}>
            <button className="row" data-testid="community-pick-group" onClick={() => void client.linkGroupToCommunity(community, c.id, visibility).then(onDone).catch(onError)}>
              <Avatar id={c.id} name={c.title} size={36} group />
              <span className="row-main"><span className="row-title">{c.title}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {candidates.length === 0 && <p className="muted-text">{t('community.noCandidates')}</p>}
      <button className="btn btn-ghost" onClick={onDone}>{t('storeLock.cancel')}</button>
    </div>
  );
}
