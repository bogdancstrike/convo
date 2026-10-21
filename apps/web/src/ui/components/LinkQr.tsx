import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Prefix of the QR payload; the comparison code is not a secret (it is also shown as digits). */
export const LINK_QR_PREFIX = 'convo-link:';

/**
 * QR form of a device-linking comparison code, so a trusted phone can scan instead of reading
 * digits. Rendered locally as SVG (no network); approval still happens on the trusted device.
 */
export function LinkQr({ code, label }: { code: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(`${LINK_QR_PREFIX}${code.replace(/\D/g, '')}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => !cancelled && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`));
    return () => { cancelled = true; };
  }, [code]);
  return src ? <img className="link-qr" src={src} alt={label} width={176} height={176} data-testid="link-qr" /> : null;
}
