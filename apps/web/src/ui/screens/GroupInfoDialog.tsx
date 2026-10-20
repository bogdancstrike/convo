import { useCallback, useEffect, useState } from 'react';
import type { AccountDto, GroupRole } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import { GroupBusyError } from '../../core/groups';
import type { Conversation } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { Dialog } from '../components/Dialog';
import { PeoplePicker } from '../components/PeoplePicker';
import { useI18n } from '../i18n/i18n';

interface MemberView {
  accountId: string;
  username: string;
  role: GroupRole;
}

/**
 * Group details (UI.md §5.4/§5.4a): members with owner/admin labels; admins add and remove
 * members. Role data comes from the server ACL mirror; names of people are directory handles.
 */
export function GroupInfoDialog({ client, conversation, onClose }: { client: EnclaveClient; conversation: Conversation; onClose: () => void }) {
  const { t } = useI18n();
  const [members, setMembers] = useState<MemberView[]>([]);
  const [adding, setAdding] = useState<AccountDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const record = await client.groupRecord(conversation.id);
    if (!record) return;
    setMembers(
      await Promise.all(record.members.map(async (m) => ({ ...m, username: await client.displayName(m.accountId) }))),
    );
  }, [client, conversation.id]);

  useEffect(() => {
    void load();
    return client.on('groups', () => void load());
  }, [client, load]);

  const myRole = members.find((m) => m.accountId === client.accountId)?.role ?? 'member';
  const canManage = myRole !== 'member' && !conversation.left;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await load();
    } catch (e) {
      console.warn('Group change failed', e instanceof Error ? `${e.name}: ${e.message}` : e);
      setError(e instanceof GroupBusyError ? t('group.busy') : t('group.changeFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog labelledBy="group-info-title" onClose={onClose}>
      <h2 id="group-info-title">{conversation.title}</h2>
      <p className="muted-text">{t('group.memberCount', { count: members.length })}</p>
      <ul className="results" data-testid="group-members">
        {members.map((m) => (
          <li key={m.accountId} className="device-row" data-testid={`member-${m.username}`}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Avatar id={m.accountId} name={m.username} size={32} />
              <span>
                @{m.username}
                {m.accountId === client.accountId && ` (${t('group.you')})`}
                {m.role !== 'member' && <span className="muted-text"> · {t(`group.role.${m.role}`)}</span>}
              </span>
            </span>
            {canManage && m.accountId !== client.accountId && (m.role !== 'owner' || myRole === 'owner') && (
              <button className="btn btn-danger" disabled={busy}
                onClick={() => {
                  if (window.confirm(t('group.confirmRemove', { name: m.username }))) void run(() => client.removeGroupMember(conversation.id, m.accountId));
                }}>
                {t('group.remove')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <section aria-labelledby="add-members-title" style={{ display: 'grid', gap: 8 }}>
          <h3 id="add-members-title" style={{ margin: 0 }}>{t('group.addMembers')}</h3>
          <PeoplePicker client={client} selected={adding} onChange={setAdding} exclude={members.map((m) => m.accountId)} />
          <button className="btn btn-primary" disabled={busy || adding.length === 0} data-testid="add-members"
            onClick={() => void run(async () => {
              await client.addGroupMembers(conversation.id, adding.map((a) => a.accountId));
              setAdding([]);
            })}>
            {t('group.add')}
          </button>
        </section>
      )}
      {error && <p role="alert" className="failed">{error}</p>}
      <button className="btn" onClick={onClose}>{t('newChat.close')}</button>
    </Dialog>
  );
}
