import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { fold, matchesMessage } from './search';
import type { ChatMessage } from './model';
import { EncryptedStore } from '../storage/encryptedStore';
import { Repositories } from './repositories';

const message = (body: string, sort = 1): ChatMessage => ({ body, sort, sentAt: sort, id: String(sort), authorId: 'alice', conversationId: 'chat', direction: 'out', reactions: {} });
describe('local message search', () => {
  it('folds Romanian accents and excludes tombstones/unavailable content', () => {
    expect(matchesMessage(message('Ședință la București'), fold('SEDINTA'))).toBe(true);
    for (const flag of ['deleted', 'unsupported', 'undecryptable']) expect(matchesMessage({ ...message('secret'), [flag]: true }, 'secret')).toBe(false);
    expect(matchesMessage({ ...message('new text'), editedAt: 2 }, 'old text')).toBe(false);
  });
  it('reads beyond the newest 200 messages and reflects updates and local deletion', async () => {
    const store = await EncryptedStore.open(`search-${Math.random()}`);
    const repos = new Repositories(store);
    await store.commit(Array.from({ length: 205 }, (_, i) => repos.putMessage(message(i === 0 ? 'old needle' : 'recent', i + 1))));
    expect((await repos.messages('chat', 200)).some((m) => matchesMessage(m, 'needle'))).toBe(false);
    expect((await repos.messages('chat', Number.MAX_SAFE_INTEGER)).filter((m) => matchesMessage(m, 'needle'))).toHaveLength(1);
    await store.commit([repos.putMessage({ ...message('changed', 1), editedAt: 5 })]);
    expect((await repos.messages('chat', Number.MAX_SAFE_INTEGER)).filter((m) => matchesMessage(m, 'needle'))).toHaveLength(0);
    await store.deleteConversationMessages('chat');
    expect(await repos.messages('chat', Number.MAX_SAFE_INTEGER)).toEqual([]);
  });
});
