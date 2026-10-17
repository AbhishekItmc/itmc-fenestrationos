import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  hint?: ReactNode;
  testId?: string;
}

export function Menu({ trigger, items, align = 'left', testId }: { trigger: (open: boolean, toggle: () => void) => ReactNode; items: MenuItem[]; align?: 'left' | 'right'; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div data-testid={testId} className={clsx('absolute top-8 z-50 min-w-[220px] rounded border border-line-strong bg-panel py-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it, i) => (
            <button
              key={i}
              data-testid={it.testId}
              disabled={it.disabled}
              className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              onClick={() => {
                setOpen(false);
                it.onClick?.();
              }}
            >
              <span className="w-4 text-faint">{it.icon}</span>
              <span className="flex-1">{it.label}</span>
              {it.hint}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
