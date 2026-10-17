import clsx from 'clsx';
import type { ReactNode } from 'react';

/** Visible "In development" tag. Use on disabled controls so no button is ever dead. */
export function InDevTag({ className, tip = 'In development — not available in this release' }: { className?: string; tip?: string }) {
  return (
    <span data-tip={tip} className={clsx('inline-flex h-4 items-center rounded-sm border border-dashed border-faint/70 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint', className)}>
      In dev
    </span>
  );
}

/** A disabled button that clearly says it is in development. */
export function InDevButton({ icon, children, tip, size = 'md' }: { icon?: ReactNode; children: ReactNode; tip?: string; size?: 'sm' | 'md' }) {
  return (
    <span data-tip={tip ?? 'In development — not available in this release'} className="inline-flex">
      <button type="button" disabled className={clsx('btn gap-1.5', size === 'sm' && 'btn-sm')} aria-disabled="true">
        {icon}
        {children}
        <InDevTag className="ml-0.5" tip="" />
      </button>
    </span>
  );
}

/** Disabled control that is only available in server mode. */
export function ServerOnlyButton({ icon, children, size = 'md' }: { icon?: ReactNode; children: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <span data-tip="Server mode only — not available in offline demo mode" className="inline-flex">
      <button type="button" disabled className={clsx('btn gap-1.5', size === 'sm' && 'btn-sm')}>
        {icon}
        {children}
        <span className="ml-0.5 rounded-sm border border-faint/60 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Server</span>
      </button>
    </span>
  );
}
