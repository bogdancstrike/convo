import { FingerprintGenerator } from '@privacyresearch/libsignal-protocol-typescript';
import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { Conversation } from '../../core/model';
import { fromBase64Url, toArrayBuffer } from '../../lib/bytes';
import { Dialog } from '../components/Dialog';
import { useI18n } from '../i18n/i18n';

/** Safety-number iterations (specs §5.6). */
const FINGERPRINT_ITERATIONS = 5200;

/**
 * Identity verification (UI.md §4.3, specs §5.6): shows the 60-digit safety number over both
 * account identity keys and lets the user record out-of-band verification.
 */
export function SafetyNumberDialog({
  client,
  conversation,
  onClose,
}: {
  client: EnclaveClient;
  conversation: Conversation;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [digits, setDigits] = useState<string | null | undefined>(undefined);
  const [verified, setVerified] = useState(false);

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

  const toggle = async () => {
    await client.setVerified(conversation.id, !verified);
    setVerified(!verified);
  };

  return (
    <Dialog labelledBy="safety-title" onClose={onClose}>
      <h2 id="safety-title">{t('safety.title')}</h2>
      {digits === null ? (
        <p>{t('safety.unavailable')}</p>
      ) : (
        <>
          <p className="muted-text">{t('safety.body', { name: conversation.title })}</p>
          <div className="safety-number" aria-label={digits ?? ''} data-testid="safety-number">
            {(digits ?? '').match(/.{1,5}/g)?.map((group, i) => <span key={i}>{group}</span>)}
          </div>
          {verified && <p>✓ {t('safety.verified')}</p>}
          <button className={verified ? 'btn' : 'btn btn-primary'} onClick={() => void toggle()} disabled={!digits}>
            {verified ? t('safety.clear') : t('safety.markVerified')}
          </button>
        </>
      )}
      <button className="btn" onClick={onClose}>
        {t('newChat.close')}
      </button>
    </Dialog>
  );
}
