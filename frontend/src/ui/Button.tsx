import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'default' | 'primary' | 'solid' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  loading?: boolean;
  iconOnly?: boolean;
  tip?: string;
  tipPos?: 'right' | 'top' | 'left';
}

export function Button({ variant = 'default', size = 'md', icon, loading, iconOnly, tip, tipPos, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      data-tip={tip}
      data-tip-pos={tipPos}
      aria-label={rest['aria-label'] ?? (iconOnly ? tip : undefined)}
      className={clsx(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'solid' && 'btn-solid',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        size === 'sm' && 'btn-sm',
        iconOnly && 'btn-icon',
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}
