import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, ShieldCheck, ShieldX } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Severity, ValidationReport, ValidationStatus } from '../api/types';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'err' | 'prov' | 'info';
const toneCls: Record<Tone, string> = {
  neutral: 'border-line-strong bg-raised text-muted',
  accent: 'border-accent/40 bg-accent/10 text-accent',
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  err: 'border-err/45 bg-err/10 text-err',
  prov: 'border-prov/50 bg-prov/10 text-prov',
  info: 'border-info/40 bg-info/10 text-info',
};

export function Chip({ tone = 'neutral', children, className, icon, tip }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode; tip?: string }) {
  return (
    <span data-tip={tip} className={clsx('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-2xs font-semibold uppercase tracking-wide', toneCls[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

const projectTone: Record<string, Tone> = { enquiry: 'neutral', design: 'info', quoted: 'accent', won: 'ok', production: 'prov', closed: 'neutral' };
export function ProjectStatusChip({ status }: { status: string }) {
  return <Chip tone={projectTone[status] ?? 'neutral'}>{status}</Chip>;
}

const vsMeta: Record<ValidationStatus, { tone: Tone; label: string; tip: string }> = {
  PROVISIONAL_DEMO_RULES: { tone: 'prov', label: 'Provisional · demo rules', tip: 'Computed with unapproved DEMO rule set — not for production' },
  FEASIBLE_HEURISTIC: { tone: 'info', label: 'Feasible · heuristic', tip: 'Passed the independent validator; optimality NOT proven' },
  OPTIMAL_PROVEN: { tone: 'ok', label: 'Optimal · proven', tip: 'Proven optimal (exact solver or bars used == valid lower bound)' },
  INVALID: { tone: 'err', label: 'Invalid', tip: 'Rejected by validation — export and release are blocked' },
  VALIDATED: { tone: 'ok', label: 'Validated', tip: 'Approved rule set and golden cases passed' },
};

export function ValidationStatusBadge({ status, className }: { status: ValidationStatus | string | null | undefined; className?: string }) {
  if (!status) return <Chip>—</Chip>;
  const m = vsMeta[status as ValidationStatus] ?? { tone: 'neutral' as Tone, label: status, tip: '' };
  return (
    <Chip tone={m.tone} tip={m.tip} className={className}>
      {m.label}
    </Chip>
  );
}

export function ValidatorBadge({ report }: { report: ValidationReport }) {
  return report.passed ? (
    <span data-tip={`Independent validator ${report.validator}\n${report.checked_items} items re-derived from the request`} className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-ok/45 bg-ok/10 px-2 text-xs font-semibold text-ok">
      <ShieldCheck className="h-3.5 w-3.5" />
      VALIDATOR PASSED
      <span className="font-mono text-2xs font-normal text-ok/80">{report.validator}</span>
    </span>
  ) : (
    <span data-tip={`${report.errors.length} error(s) — export/release blocked`} className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-err/50 bg-err/10 px-2 text-xs font-semibold text-err">
      <ShieldX className="h-3.5 w-3.5" />
      VALIDATOR FAILED
      <span className="font-mono text-2xs font-normal">{report.validator}</span>
    </span>
  );
}

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  if (severity === 'error') return <CircleAlert className={clsx('h-3.5 w-3.5 shrink-0 text-err', className)} />;
  if (severity === 'warning') return <AlertTriangle className={clsx('h-3.5 w-3.5 shrink-0 text-warn', className)} />;
  return <Info className={clsx('h-3.5 w-3.5 shrink-0 text-info', className)} />;
}

export function OkIcon({ className }: { className?: string }) {
  return <CheckCircle2 className={clsx('h-3.5 w-3.5 text-ok', className)} />;
}
