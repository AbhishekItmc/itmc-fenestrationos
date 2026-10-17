import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { fmtMm, parseLength } from '../lib/format';

/** Labelled form field. Use `group` for composite controls (segmented buttons) so no <label> wraps them. */
export function Field({ label, hint, error, children, className, group }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; group?: boolean }) {
  const body = (
    <>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-2xs text-err">{error}</span> : hint ? <span className="mt-1 block text-2xs text-faint">{hint}</span> : null}
    </>
  );
  return group ? (
    <div role="group" className={clsx('block', className)}>
      {body}
    </div>
  ) : (
    <label className={clsx('block', className)}>{body}</label>
  );
}

/**
 * Numeric length input that commits on Enter/blur, validates (min/max) and shows the unit.
 * Accepts "1234.5", "1.2m", "120cm".
 */
export function LengthInput({
  value,
  onCommit,
  min,
  max,
  unit = 'mm',
  disabled,
  className,
  testId,
  integer,
  allowUnits = true,
}: {
  value: number | null | undefined;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
  integer?: boolean;
  allowUnits?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : fmtMm(value, 3));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(value == null ? '' : fmtMm(value, 3));
    setErr(null);
  }, [value]);
  const commit = () => {
    const v = allowUnits ? parseLength(text) : Number(text);
    if (v === null || !Number.isFinite(v)) return setErr('Enter a number');
    if (integer && !Number.isInteger(v)) return setErr('Whole number required');
    if (min !== undefined && v < min) return setErr(`Min ${fmtMm(min)}`);
    if (max !== undefined && v > max) return setErr(`Max ${fmtMm(max)}`);
    setErr(null);
    if (v !== value) onCommit(v);
  };
  return (
    <div className={clsx('relative', className)}>
      <input
        data-testid={testId}
        className={clsx('input input-num pr-9', err && 'invalid')}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(value == null ? '' : fmtMm(value, 3));
            setErr(null);
          }
          e.stopPropagation();
        }}
        inputMode="decimal"
        title={err ?? undefined}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-2xs text-faint">{unit}</span>
      {err && <span className="mt-0.5 block text-2xs text-err">{err}</span>}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, disabled, className, testId, placeholder }: { value: T | '' | null | undefined; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[]; disabled?: boolean; className?: string; testId?: string; placeholder?: string }) {
  return (
    <select data-testid={testId} className={clsx('input', className)} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled, testId, tip }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; testId?: string; tip?: string }) {
  return (
    <label data-tip={tip} className={clsx('inline-flex cursor-pointer select-none items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        data-testid={testId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-4 w-7 rounded-full border transition-colors', checked ? 'border-accent bg-accent/30' : 'border-line-strong bg-bg')}
      >
        <span className={clsx('absolute top-[1px] h-3 w-3 rounded-full transition-all', checked ? 'left-[13px] bg-accent' : 'left-[1px] bg-faint')} />
      </button>
      {label}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, testId }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; tip?: string; disabled?: boolean }[]; testId?: string }) {
  return (
    <div className="seg" data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} data-tip={o.tip} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
