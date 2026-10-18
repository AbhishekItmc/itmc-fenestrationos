import clsx from 'clsx';
import { AlertTriangle, Boxes, Frame, PanelTop } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Part, PartDetail } from '../../api/types';
import { fmtPartSize, partUrl, stationLabel } from '../../engine/production';
import { fmtDateTime } from '../../lib/format';
import { QrImage } from '../../ui/QrImage';
import { EventTimeline, PartActions, PartStatusChip, RouteProgress } from './common';

export const kindIcon = (k: Part['kind'], cls = 'h-4 w-4') => (k === 'profile' ? <Boxes className={cls} /> : k === 'panel' ? <PanelTop className={cls} /> : <Frame className={cls} />);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm">{children}</dd>
    </div>
  );
}

/**
 * Full part view: identity, route progress, actions (when `station` is set), details and history.
 * `station` = the station acting on the part (workstation view) or the part's own current station (drawer / part page).
 */
export function PartPanel({
  detail,
  station,
  onChanged,
  size = 'md',
  canAct = true,
  mismatch,
}: {
  detail: PartDetail;
  station: string | null;
  onChanged: (p: Part) => void;
  size?: 'md' | 'lg';
  canAct?: boolean;
  mismatch?: ReactNode;
}) {
  const p = detail.part;
  const big = size === 'lg';
  return (
    <div className="space-y-4" data-testid="part-panel">
      <div className="flex items-start gap-3">
        <div className={clsx('flex shrink-0 items-center justify-center rounded-md border border-line bg-raised text-muted', big ? 'h-12 w-12' : 'h-10 w-10')}>{kindIcon(p.kind, big ? 'h-6 w-6' : 'h-5 w-5')}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('font-mono font-semibold tracking-wider', big ? 'text-2xl' : 'text-xl')} data-testid="part-code">
              {p.code}
            </span>
            <PartStatusChip status={p.status} />
          </div>
          <div className={clsx('mt-0.5 line-clamp-2 break-words', big ? 'text-md' : 'text-sm')}>
            <span className="font-semibold">
              {p.mark}
              <span className="text-faint">·{p.seq}</span>
            </span>{' '}
            <span className="text-muted">{p.description}</span>
          </div>
          <div className="mt-0.5 font-mono text-xs text-muted">{fmtPartSize(p)}</div>
        </div>
        {!big && (
          <div className="shrink-0 rounded-sm border border-line bg-sheet p-1" title="Label QR (opens this part page)">
            <QrImage value={partUrl(window.location.origin, p.code)} size={60} testId="part-qr" />
          </div>
        )}
      </div>

      <div className="rounded border border-line bg-bg/40 px-2 pb-2 pt-3">
        <RouteProgress part={p} size={big ? 'lg' : 'md'} />
        <div className="mt-2 text-center text-xs text-muted" data-testid="part-current-station">
          {p.status === 'done' ? (
            <span className="font-semibold text-ok">All stations complete</span>
          ) : (
            <>
              Current station: <span className="font-semibold text-fg">{stationLabel(p.current_station)}</span>
            </>
          )}
        </div>
      </div>

      {mismatch && (
        <div className="flex items-start gap-2 rounded border border-warn/45 bg-warn/10 px-3 py-2 text-sm text-warn" data-testid="station-mismatch">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">{mismatch}</div>
        </div>
      )}

      {station && <PartActions part={p} station={station} onChanged={onChanged} size={size} canAct={canAct} />}

      <dl className="rounded border border-line bg-panel px-3 py-1">
        <Row label="Item">
          <span className="font-mono">{p.item_code}</span>
        </Row>
        {p.kind === 'profile' && (
          <Row label="Cut angles">
            <span className="font-mono">
              {p.angle_start ?? 90}° / {p.angle_end ?? 90}°
            </span>
          </Row>
        )}
        <Row label="Elevation">{p.elevation_name ?? '—'}</Row>
        {p.field_key && (
          <Row label="Field">
            <span className="font-mono">{p.field_key}</span>
          </Row>
        )}
        <Row label="Work order">
          <span className="font-mono">{detail.order.number}</span> · {detail.order.name}
        </Row>
        <Row label="Project">
          <span className="font-mono">{detail.project.code}</span> · {detail.project.name}
        </Row>
        <Row label="Updated">{fmtDateTime(p.updated_at)}</Row>
      </dl>

      <div>
        <div className="section-title mb-2">History</div>
        <EventTimeline events={detail.events} />
      </div>
    </div>
  );
}
