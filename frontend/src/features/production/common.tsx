import clsx from 'clsx';
import { Ban, Check, CheckCircle2, CircleDot, MessageSquarePlus, Play, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import type { Part, PartAction, PartEvent, PartStatus, ProductionStatus } from '../../api/types';
import { allowedActions, stationLabel } from '../../engine/production';
import { fmtDateTime } from '../../lib/format';
import { useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { Chip } from '../../ui/Badge';
import { Button } from '../../ui/Button';

const partTone: Record<PartStatus, 'neutral' | 'info' | 'ok' | 'err'> = { pending: 'neutral', in_progress: 'info', done: 'ok', blocked: 'err' };
export function PartStatusChip({ status, className }: { status: PartStatus; className?: string }) {
  return (
    <Chip tone={partTone[status]} className={className}>
      {status.replace('_', ' ')}
    </Chip>
  );
}

const orderTone: Record<ProductionStatus, 'neutral' | 'accent' | 'info' | 'ok' | 'err'> = { planned: 'neutral', released: 'accent', in_progress: 'info', done: 'ok', cancelled: 'err' };
export function OrderStatusChip({ status }: { status: ProductionStatus }) {
  return <Chip tone={orderTone[status] ?? 'neutral'}>{status.replace('_', ' ')}</Chip>;
}

/** Status dot colour classes (token based). */
export const statusDot: Record<PartStatus, string> = { pending: 'bg-faint', in_progress: 'bg-info', done: 'bg-ok', blocked: 'bg-err' };

/** Horizontal stepper of the part's route. */
export function RouteProgress({ part, size = 'md' }: { part: Pick<Part, 'route' | 'station_index' | 'status'>; size?: 'md' | 'lg' }) {
  const route = part.route as string[];
  return (
    <ol className="flex w-full items-start" data-testid="route-progress">
      {route.map((s, i) => {
        const done = i < part.station_index || part.status === 'done';
        const current = i === part.station_index && part.status !== 'done';
        return (
          <li key={s} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <span className={clsx('h-0.5 flex-1', i === 0 ? 'bg-transparent' : done || current ? 'bg-ok' : 'bg-line')} />
              <span
                className={clsx(
                  'flex shrink-0 items-center justify-center rounded-full border-2',
                  size === 'lg' ? 'h-7 w-7' : 'h-5 w-5',
                  done ? 'border-ok bg-ok text-[rgb(var(--on-accent))]' : current ? (part.status === 'blocked' ? 'border-err bg-err/15 text-err' : 'border-accent bg-accent/15 text-accent') : 'border-line-strong bg-panel text-faint',
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : current ? <CircleDot className="h-3 w-3" /> : null}
              </span>
              <span className={clsx('h-0.5 flex-1', i === route.length - 1 ? 'bg-transparent' : done ? 'bg-ok' : 'bg-line')} />
            </div>
            <span className={clsx('mt-1 line-clamp-2 w-full break-words px-0.5 text-center leading-tight', size === 'lg' ? 'text-[11px] sm:text-xs' : 'text-[11px]', current ? 'font-semibold text-fg' : 'text-muted')} title={stationLabel(s)}>
              {stationLabel(s)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const actionMeta: Record<PartAction, { label: string; tone: string }> = {
  start: { label: 'Started', tone: 'text-info' },
  complete: { label: 'Completed', tone: 'text-ok' },
  block: { label: 'Blocked', tone: 'text-err' },
  unblock: { label: 'Unblocked', tone: 'text-accent' },
  note: { label: 'Note', tone: 'text-muted' },
};

export function EventTimeline({ events }: { events: PartEvent[] }) {
  if (!events.length) return <div className="px-1 py-2 text-sm text-faint">No events yet — the part has not been scanned.</div>;
  return (
    <ol className="relative ml-1.5 border-l border-line pl-4" data-testid="event-timeline">
      {[...events].reverse().map((e) => (
        <li key={e.id} className="relative pb-3 last:pb-0">
          <span className={clsx('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-panel', e.action === 'block' ? 'bg-err' : e.action === 'complete' ? 'bg-ok' : e.action === 'start' ? 'bg-info' : 'bg-faint')} />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className={clsx('font-semibold', actionMeta[e.action]?.tone)}>{actionMeta[e.action]?.label ?? e.action}</span>
            <span className="text-muted">{stationLabel(e.station)}</span>
            <span className="ml-auto font-mono text-2xs text-faint">{fmtDateTime(e.ts)}</span>
          </div>
          {e.note && <div className="mt-0.5 rounded-sm bg-raised px-2 py-1 text-xs text-fg">{e.note}</div>}
          <div className="text-2xs text-faint">{e.user_name ?? (e.user_id ? `user #${e.user_id}` : '')}</div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Operator actions for a part at a station. Buttons follow the transition rules; the server/offline backend
 * re-checks and answers 409 INVALID_TRANSITION otherwise.
 */
export function PartActions({ part, station, onChanged, size = 'md', canAct = true }: { part: Part; station: string | null; onChanged: (p: Part) => void; size?: 'md' | 'lg'; canAct?: boolean }) {
  const be = useBackend();
  const [mode, setMode] = useState<null | 'block' | 'note'>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<PartAction | null>(null);
  const allowed = canAct ? allowedActions(part, station) : [];
  const big = size === 'lg';

  const act = async (action: PartAction) => {
    if (!station) return;
    if ((action === 'block' || action === 'note') && !note.trim()) {
      setMode(action);
      return;
    }
    setBusy(action);
    try {
      const p = await be.postPartEvent(part.code, { station, action, note: action === 'block' || action === 'note' ? note.trim() : null });
      onChanged(p);
      setMode(null);
      setNote('');
      const msg: Record<PartAction, string> = {
        start: `Started at ${stationLabel(station)}`,
        complete: p.status === 'done' ? 'Completed — part is done' : `Completed → next: ${stationLabel(p.current_station)}`,
        block: 'Part blocked',
        unblock: 'Part unblocked',
        note: 'Note added',
      };
      toast.success(`${part.code} · ${msg[action]}`);
    } catch (e) {
      toast.error('Action refused', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const cls = big ? 'h-14 flex-1 justify-center text-md min-w-[120px]' : 'flex-1 justify-center';
  return (
    <div className="space-y-2" data-testid="part-actions">
      {!canAct && <div className="text-xs text-faint">Sign in as operator, engineer or admin to record actions.</div>}
      <div className={clsx('flex flex-wrap gap-2')}>
        <Button variant="solid" className={cls} icon={<Play className={big ? 'h-5 w-5' : 'h-3.5 w-3.5'} />} disabled={!allowed.includes('start')} loading={busy === 'start'} onClick={() => void act('start')} data-testid="action-start">
          Start
        </Button>
        <Button variant="primary" className={clsx(cls, allowed.includes('complete') && 'border-ok/70 bg-ok/15 text-ok')} icon={<CheckCircle2 className={big ? 'h-5 w-5' : 'h-3.5 w-3.5'} />} disabled={!allowed.includes('complete')} loading={busy === 'complete'} onClick={() => void act('complete')} data-testid="action-complete">
          Complete
        </Button>
        {part.status === 'blocked' ? (
          <Button className={cls} icon={<Undo2 className={big ? 'h-5 w-5' : 'h-3.5 w-3.5'} />} disabled={!allowed.includes('unblock')} loading={busy === 'unblock'} onClick={() => void act('unblock')} data-testid="action-unblock">
            Unblock
          </Button>
        ) : (
          <Button variant="danger" className={cls} icon={<Ban className={big ? 'h-5 w-5' : 'h-3.5 w-3.5'} />} disabled={!allowed.includes('block')} onClick={() => setMode(mode === 'block' ? null : 'block')} data-testid="action-block">
            Block…
          </Button>
        )}
        <Button variant="ghost" className={clsx(big ? 'h-14 justify-center' : '')} icon={<MessageSquarePlus className={big ? 'h-5 w-5' : 'h-3.5 w-3.5'} />} disabled={!allowed.includes('note')} onClick={() => setMode(mode === 'note' ? null : 'note')} data-testid="action-note" tip="Add a note">
          {big ? 'Note' : undefined}
        </Button>
      </div>
      {mode && (
        <div className={clsx('rounded border p-2', mode === 'block' ? 'border-err/40 bg-err/5' : 'border-line bg-raised/50')}>
          <label className="label" htmlFor="part-note">
            {mode === 'block' ? 'Reason for blocking (required)' : 'Note'}
          </label>
          <textarea id="part-note" className={clsx('input py-1.5', big ? 'h-20 text-md' : 'h-14')} value={note} autoFocus onChange={(e) => setNote(e.target.value)} placeholder={mode === 'block' ? 'e.g. profile damaged, wrong length, missing drawing…' : ''} data-testid="action-note-text" />
          <div className="mt-2 flex gap-2">
            <Button variant={mode === 'block' ? 'danger' : 'solid'} className={clsx(big && 'h-12 flex-1 justify-center text-md')} disabled={!note.trim()} loading={busy === mode} onClick={() => void act(mode)} data-testid="action-confirm">
              {mode === 'block' ? 'Block part' : 'Add note'}
            </Button>
            <Button className={clsx(big && 'h-12')} onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
