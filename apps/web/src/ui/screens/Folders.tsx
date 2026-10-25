import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { MAX_FOLDER_NAME, type ChatFolder, type FolderType } from '../../core/folders';
import type { Conversation } from '../../core/model';
import { Dialog } from '../components/Dialog';
import { useI18n } from '../i18n/i18n';

/** Live folder list from the client (updates when another own device changes them). */
export function useFolders(client: EnclaveClient): ChatFolder[] {
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  useEffect(() => { void client.folders().then(setFolders); return client.on('folders', setFolders); }, [client]);
  return folders;
}

/**
 * Create or edit a private chat folder (specs §30.4): name, chat types to include, explicitly
 * chosen chats and "unread only". Folders are visible only to this account, on its own devices.
 */
export function FolderEditor({ client, conversations, folder, onClose }: { client: EnclaveClient; conversations: Conversation[]; folder?: ChatFolder; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(folder?.name ?? '');
  const [types, setTypes] = useState<FolderType[]>(folder?.types ?? []);
  const [chats, setChats] = useState<string[]>(folder?.chats ?? []);
  const [unreadOnly, setUnreadOnly] = useState(folder?.unreadOnly ?? false);
  const [busy, setBusy] = useState(false);
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const save = async (remove = false) => {
    setBusy(true);
    const all = await client.folders();
    const next: ChatFolder = { id: folder?.id ?? crypto.randomUUID().replace(/-/g, ''), name, types, chats, unreadOnly };
    await client.saveFolders(remove ? all.filter((f) => f.id !== folder?.id) : folder ? all.map((f) => (f.id === folder.id ? next : f)) : [...all, next]);
    setBusy(false); onClose();
  };
  return (
    <Dialog labelledBy="folder-title" onClose={onClose}>
      <div data-testid="folder-editor">
        <h2 id="folder-title">{t(folder ? 'folders.edit' : 'folders.create')}</h2>
        <label className="field"><span>{t('folders.name')}</span><input value={name} maxLength={MAX_FOLDER_NAME} onChange={(e) => setName(e.target.value)} data-testid="folder-name" autoFocus /></label>
        <fieldset className="folder-types"><legend>{t('folders.includeTypes')}</legend>
          {(['direct', 'group', 'channel'] as const).map((type) => (
            <label key={type}><input type="checkbox" checked={types.includes(type)} onChange={() => setTypes(toggle(types, type))} data-testid={`folder-type-${type}`} /> {t(`folders.type.${type}`)}</label>
          ))}
          <label><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} data-testid="folder-unread" /> {t('folders.unreadOnly')}</label>
        </fieldset>
        <fieldset className="folder-chats"><legend>{t('folders.chats')}</legend>
          {conversations.filter((c) => c.kind !== 'note').map((c) => (
            <label key={c.id}><input type="checkbox" checked={chats.includes(c.id)} onChange={() => setChats(toggle(chats, c.id))} data-testid={`folder-chat-${c.title}`} /> {c.title}</label>
          ))}
        </fieldset>
        <p className="muted-text">{t('folders.private')}</p>
        <div className="dialog-actions">
          {folder && <button className="btn btn-ghost danger" disabled={busy} onClick={() => void save(true)} data-testid="folder-delete">{t('folders.delete')}</button>}
          <button className="btn" onClick={onClose}>{t('thread.cancel')}</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()} data-testid="folder-save">{t('event.save')}</button>
        </div>
      </div>
    </Dialog>
  );
}
