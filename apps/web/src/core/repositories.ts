import type { EncryptedStore, StoreOp } from '../storage/encryptedStore';
import { DEFAULT_SETTINGS, messageKey, type ChatMessage, type Conversation, type DeviceState, type Settings } from './model';

/**
 * Typed accessors for the encrypted store. Mutating methods return {@link StoreOp}s instead of
 * writing, so the core can commit them together with protocol state in one transaction.
 */
export const RecordNs = {
  device: 'device',
  settings: 'settings',
  conversation: 'conversation',
  outbox: 'outbox',
  pendingEnrollment: 'pending-enrollment',
  localDeletedMessage: 'local-deleted-message',
  localHiddenConversation: 'local-hidden-conversation',
  /** Attachments prepared while offline, uploaded and sent when the network returns. */
  pendingUploads: 'pending-uploads',
  /** Last seen own-device list, for security notices on change. */
  knownDevices: 'known-devices',
  /** Device-local call history (`CallLogEntry`). */
  callLog: 'call-log',
  /** Private community onboarding progress per root group (`OnboardingProgress`). */
  onboarding: 'onboarding',
  /** Device-local reading position per conversation (not synced; specs §30.8 catch-up). */
  anchors: 'anchors',
  /** Reviewer only: rules acknowledgements per root group (current version only). */
  rulesAcks: 'rules-acks',
  /** Scheduled messages owned by this device (`ScheduledMessage`); sent only from here. */
  scheduled: 'scheduled',
  /** Private chat folders (`FolderState`, single record), synced to own devices only. */
  folders: 'folders',
  /** Personal sticker collection (`StickerCollection`, single record 'state'), synced to own devices. */
  stickers: 'stickers',
  /** Decrypted custom sticker images by ID (base64url), device-local cache. */
  stickerData: 'sticker-data',
  /** Last verified organization policy (`VerifiedPolicy`, single record 'current'; pins the key). */
  policy: 'policy',
  /** Device-local event reminders (`EventReminder`), keyed by event message. */
  reminders: 'reminders',
  /** Key transparency: pinned log/witness keys and the newest accepted head (`KtState`, record 'state'). */
  kt: 'kt',
  /** Key transparency: last result per account (`KtAccountRecord`). */
  ktAccounts: 'kt-accounts',
} as const;

export class Repositories {
  constructor(readonly store: EncryptedStore) {}

  deviceState(): Promise<DeviceState | undefined> {
    return this.store.get<DeviceState>(RecordNs.device, 'self');
  }

  putDeviceState(state: DeviceState): StoreOp {
    return { type: 'put', ns: RecordNs.device, id: 'self', value: state };
  }

  async settings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await this.store.get<Partial<Settings>>(RecordNs.settings, 'self')) };
  }

  putSettings(settings: Settings): StoreOp {
    return { type: 'put', ns: RecordNs.settings, id: 'self', value: settings };
  }

  conversations(): Promise<Conversation[]> {
    return this.store.list<Conversation>(RecordNs.conversation);
  }

  conversation(id: string): Promise<Conversation | undefined> {
    return this.store.get<Conversation>(RecordNs.conversation, id);
  }

  putConversation(conversation: Conversation): StoreOp {
    return { type: 'put', ns: RecordNs.conversation, id: conversation.id, value: conversation };
  }

  message(conversationId: string, authorId: string, messageId: string): Promise<ChatMessage | undefined> {
    return this.store.getMessage<ChatMessage>(conversationId, messageKey(authorId, messageId));
  }

  isLocallyDeleted(message: Pick<ChatMessage, 'conversationId' | 'authorId' | 'id'>): Promise<boolean | undefined> {
    return this.store.get<boolean>(RecordNs.localDeletedMessage, JSON.stringify([message.conversationId, message.authorId, message.id]));
  }

  localDeletion(message: ChatMessage): StoreOp[] {
    return [{ type: 'put', ns: RecordNs.localDeletedMessage, id: JSON.stringify([message.conversationId, message.authorId, message.id]), value: true },
      { type: 'deleteMessage', conversationId: message.conversationId, messageKey: messageKey(message.authorId, message.id) }];
  }

  messages(conversationId: string, limit: number, before?: number): Promise<ChatMessage[]> {
    return this.store.messages<ChatMessage>(conversationId, limit, before);
  }

  putMessage(message: ChatMessage): StoreOp {
    return {
      type: 'message',
      message: {
        conversationId: message.conversationId,
        messageKey: messageKey(message.authorId, message.id),
        sort: message.sort,
        value: message,
      },
    };
  }
}
