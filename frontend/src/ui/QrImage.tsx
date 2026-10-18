import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { qrDataUrl } from '../lib/qr';

/** QR code image for a payload (rendered in the browser). */
export function QrImage({ value, size = 96, className, testId }: { value: string; size?: number; className?: string; testId?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    qrDataUrl(value, Math.max(128, size * 2))
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src ? (
    <img src={src} alt={`QR code: ${value}`} width={size} height={size} className={clsx('block [image-rendering:pixelated]', className)} data-testid={testId} />
  ) : (
    <span className={clsx('block animate-pulse bg-raised', className)} style={{ width: size, height: size }} aria-hidden />
  );
}
