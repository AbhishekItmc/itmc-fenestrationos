import { ChevronLeft, ChevronRight, Mail } from 'lucide-react';
import { Fragment, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { fmtDateTime } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { toast } from '../../store/toast';
import { Chip } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorBlock, LoadingBlock } from '../../ui/Misc';

export type LeadStatus = 'new' | 'contacted' | 'closed';
export interface Lead {
  id: number;
  name: string;
  company: string;
  email: string;
  phone: string | null;
  country: string | null;
  message: string;
  interest: string[];
  source_page: string | null;
  status: LeadStatus;
  created_at: string;
  user_agent: string | null;
}
interface LeadPage {
  items: Lead[];
  total: number;
  limit: number;
  offset: number;
}

const STATUSES: LeadStatus[] = ['new', 'contacted', 'closed'];
const tone = { new: 'accent', contacted: 'info', closed: 'neutral' } as const;

/** Demo requests from the public website (server mode, admin only — GET/PUT /api/v1/admin/leads). */
export function LeadsTab() {
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const limit = 50;
  const { data, loading, error, reload } = useAsync(() => api.get<LeadPage>('/admin/leads', { query: { status: status || undefined, limit, offset } }), [status, offset]);
  const update = async (l: Lead, s: LeadStatus) => {
    try {
      await api.put<Lead>(`/admin/leads/${l.id}`, { status: s });
      toast.success('Lead updated', `${l.company} → ${s}`);
      reload();
    } catch (e) {
      toast.error('Update failed', errorMessage(e));
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="leads-tab">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <div className="seg" role="group" aria-label="Filter by status">
          {(['', ...STATUSES] as const).map((s) => (
            <button
              key={s || 'all'}
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                setOffset(0);
              }}
            >
              {s || 'all'}
            </button>
          ))}
        </div>
        <div className="flex-1 text-xs text-muted">Demo requests submitted on the public website contact page.</div>
        <span className="font-mono text-2xs text-faint">{data && data.total ? `${offset + 1}–${Math.min(offset + limit, data.total)} of ${data.total}` : ''}</span>
        <Button size="sm" iconOnly icon={<ChevronLeft className="h-3.5 w-3.5" />} tip="Previous" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} />
        <Button size="sm" iconOnly icon={<ChevronRight className="h-3.5 w-3.5" />} tip="Next" disabled={!data || offset + limit >= data.total} onClick={() => setOffset(offset + limit)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <EmptyState icon={<Mail className="h-5 w-5" />} title="No demo requests" detail={status ? `No leads with status “${status}”.` : 'Requests from the website contact form will appear here.'} />
        ) : (
          <table className="dense" data-testid="leads-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Company</th>
                <th>Name</th>
                <th>E-mail</th>
                <th>Interest</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => (
                <Fragment key={l.id}>
                  <tr className="cursor-pointer" onClick={() => setOpen(open === l.id ? null : l.id)} data-testid={`lead-row-${l.id}`}>
                    <td className="font-mono text-xs text-muted">{fmtDateTime(l.created_at)}</td>
                    <td className="font-medium">{l.company}</td>
                    <td>{l.name}</td>
                    <td className="font-mono text-xs">
                      <a href={`mailto:${l.email}`} className="hover:text-accent" onClick={(e) => e.stopPropagation()}>
                        {l.email}
                      </a>
                    </td>
                    <td className="text-xs text-muted">{l.interest.join(', ') || '—'}</td>
                    <td>
                      <Chip tone={tone[l.status]}>{l.status}</Chip>
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <select className="input h-6 w-[120px] text-xs" value={l.status} onChange={(e) => void update(l, e.target.value as LeadStatus)} aria-label={`Status of lead ${l.id}`} data-testid={`lead-status-${l.id}`}>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  {open === l.id && (
                    <tr>
                      <td colSpan={7} className="!h-auto whitespace-normal bg-raised/40 !py-3">
                        <div className="grid max-w-[900px] gap-1 text-sm">
                          <div className="whitespace-pre-wrap">{l.message}</div>
                          <div className="mt-2 font-mono text-2xs text-faint">
                            {[l.phone && `phone ${l.phone}`, l.country && `country ${l.country}`, l.source_page && `from ${l.source_page}`].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
