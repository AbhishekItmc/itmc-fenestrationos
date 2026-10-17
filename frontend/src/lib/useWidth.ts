import { useCallback, useRef, useState } from 'react';

/** Observe an element's content width via a callback ref (works for conditionally rendered nodes). */
export function useWidth<T extends HTMLElement>(fallback = 800) {
  const [w, setW] = useState(fallback);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    const obs = new ResizeObserver(() => setW(Math.max(200, el.clientWidth - 32)));
    obs.observe(el);
    ro.current = obs;
  }, []);
  return [ref, w] as const;
}
