import { useEffect, useState } from 'react';

/** Subscribe to a CSS media query (SSR/test safe). */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const h = () => setMatch(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return match;
}

/** Phone / small-tablet layout: sidebar becomes a drawer, top bar compacts. */
export const NARROW_QUERY = '(max-width: 899px)';
