/** Client-side QR rendering (qrcode, MIT). Used for offline labels and on-screen previews. */
import QRCode from 'qrcode';

const cache = new Map<string, Promise<string>>();

/** PNG data URL of a QR code for `payload`. Error correction M, no quiet zone (labels add their own margin). */
export function qrDataUrl(payload: string, px = 256): Promise<string> {
  const key = `${px}|${payload}`;
  let p = cache.get(key);
  if (!p) {
    p = QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 0, width: px, color: { dark: '#000000', light: '#ffffff' } });
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}
