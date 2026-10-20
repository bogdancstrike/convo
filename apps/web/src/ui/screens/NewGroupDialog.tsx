import { useState } from 'react';
import type { AccountDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import type { Conversation } from '../../core/model';
import { Dialog } from '../components/Dialog';
import { PeoplePicker } from '../components/PeoplePicker';
import { useI18n } from '../i18n/i18n';

/** Creates an end-to-end encrypted MLS group (UI.md §5.4). The name is encrypted for members. */
export function NewGroupDialog({
  client,
  onCreated,
  onClose,
}: {
  client: EnclaveClient;
  onCreated: (conversation: Conversation) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [people, setPeople] = useState<AccountDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await client.createGroup(name, people));
    } catch (e) {
      console.warn('Group creation failed', e instanceof Error ? e.message : e);
      setError(t('group.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog labelledBy="new-group-title" onClose={onClose}>
      <h2 id="new-group-title">{t('group.new')}</h2>
      <label>
        {t('group.name')}
        <input className="input" value={name} maxLength={128} onChange={(e) => setName(e.target.value)} data-testid="group-name" />
      </label>
      <p className="muted-text">{t('group.encryptedHint')}</p>
      <PeoplePicker client={client} selected={people} onChange={setPeople} />
      {error && <p role="alert" className="failed">{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>{t('thread.cancel')}</button>
        <button className="btn btn-primary" disabled={busy || !name.trim() || people.length === 0} onClick={() => void create()} data-testid="create-group">
          {busy ? t('group.creating') : t('group.create')}
        </button>
      </div>
    </Dialog>
  );
}
