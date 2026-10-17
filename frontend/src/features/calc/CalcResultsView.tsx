import { FileDown, LayoutGrid, Ruler } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import type { Issue } from '../../api/types';
import { fmtArea, fmtDateTime, fmtM, fmtMm, fmtNum, fmtQty } from '../../lib/format';
import { useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { ValidationStatusBadge, ValidatorBadge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ServerOnlyButton } from '../../ui/InDev';
import { IssueList, Kpi, OfflineEngineLabel, ProvisionalBanner, Tabs } from '../../ui/Misc';
import { useCutting } from '../cutting/store';
import { useNesting } from '../nesting/store';
import type { CalcEntry } from './store';
import { cuttingDraftFromCalc, fillGroupsInResult, nestingDraftFromCalc, profilesInResult } from './transfer';

type Tab = 'cuts' | 'glass' | 'bom' | 'issues' | 'totals';

export function CalcResultsView({ entry, onPickIssue }: { entry: CalcEntry; onPickIssue?: (i: Issue) => void }) {
  const r = entry.result;
  const cat = useApp((s) => s.catalogue);
  const be = useBackend();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>(r.validation_status === 'INVALID' ? 'issues' : 'cuts');
  const profiles = profilesInResult(r);
  const groups = fillGroupsInResult(r, cat);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
  const [groupKey, setGroupKey] = useState(groups[0]?.key ?? '');
  const invalid = r.validation_status === 'INVALID';
  const errors = r.issues.filter((i) => i.severity === 'error').length;
  const warnings = r.issues.filter((i) => i.severity === 'warning').length;

  const sendToCutting = () => {
    if (!profileId) return;
    useCutting.getState().replaceDraft(cuttingDraftFromCalc(r, profileId, cat, entry.elevationName));
    toast.success('Sent to 1D cutting', `${profiles.find((p) => p.id === profileId)?.code} — ${r.profile_cuts.filter((c) => c.profile_id === profileId).length} piece types`);
    nav('/cutting');
  };
  const sendToNesting = () => {
    if (!groupKey) return;
    useNesting.getState().replaceDraft(nestingDraftFromCalc(r, groupKey, cat, entry.elevationName));
    toast.success('Sent to 2D nesting', groups.find((g) => g.key === groupKey)?.label);
    nav('/nesting');
  };
  const download = async (fmt: 'pdf' | 'xlsx') => {
    if (!entry.runId) return;
    try {
      await be.downloadReport('calc', entry.runId, fmt);
    } catch (e) {
      toast.error('Download failed', errorMessage(e));
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="calc-results">
      <div className="space-y-2 border-b border-line px-4 py-3">
        <ProvisionalBanner />
        <div className="flex flex-wrap items-center gap-2">
          <ValidationStatusBadge status={r.validation_status} />
          <ValidatorBadge report={r.validation} />
          {entry.engine === 'offline' && <OfflineEngineLabel />}
          <span className="ml-auto font-mono text-2xs text-faint" data-tip={`inputs_hash ${r.inputs_hash}`}>
            {r.engine_version} · {r.rule_set_id}@{r.rule_set_version} · {fmtDateTime(entry.at)}
            {entry.runId ? ` · run #${entry.runId}` : ' · not persisted'}
          </span>
        </div>
        {invalid && (
          <div className="rounded border border-err/40 bg-err/10 px-3 py-2 text-sm text-err">
            Calculation blocked by {errors} error(s). Fix the issues listed below — no cut list, glass list or BOM is produced for invalid input.
          </div>
        )}
      </div>
      {!invalid && (
        <div className="flex border-b border-line">
          <Kpi label="Profile length" value={fmtM((r.totals.profile_length_m ?? 0) * 1000)} sub={`${r.profile_cuts.length} cut groups`} />
          <Kpi label="Glass area" value={fmtArea(r.totals.glass_area_m2)} sub={`${fmtNum(r.totals.fill_count ?? 0)} fills`} />
          <Kpi label="Panel area" value={fmtArea(r.totals.panel_area_m2)} />
          <Kpi label="Weight (demo)" value={`${fmtNum((r.totals.profile_weight_kg_demo ?? 0) + (r.totals.glass_weight_kg_demo ?? 0), 0)} kg`} sub="profiles + glass" tone="prov" />
          <Kpi label="Issues" value={`${errors} / ${warnings}`} sub="errors / warnings" tone={errors ? 'err' : warnings ? 'warn' : 'ok'} />
        </div>
      )}
      <Tabs
        className="px-3"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'cuts', label: 'Profile cut list', count: r.profile_cuts.length },
          { value: 'glass', label: 'Glass & panels', count: r.glass_items.length },
          { value: 'bom', label: 'BOM', count: r.bom.length },
          { value: 'issues', label: 'Issues', count: r.issues.length },
          { value: 'totals', label: 'Totals' },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'cuts' && (
          <table className="dense" data-testid="cut-list">
            <thead>
              <tr>
                <th>Mark</th>
                <th>Role</th>
                <th>Profile</th>
                <th className="num">Length</th>
                <th className="num">Qty</th>
                <th>Angles</th>
                <th>Formula (demo rule)</th>
              </tr>
            </thead>
            <tbody>
              {r.profile_cuts.map((c) => (
                <tr key={c.mark}>
                  <td className="font-mono font-medium">{c.mark}</td>
                  <td className="capitalize text-muted">{c.role.replace('_', ' ')}</td>
                  <td className="font-mono text-xs">{c.profile_code}</td>
                  <td className="num">{fmtMm(c.length, 2)}</td>
                  <td className="num">{c.quantity}</td>
                  <td className="font-mono text-xs text-muted">
                    {c.angle_start}°/{c.angle_end}°
                  </td>
                  <td className="max-w-[420px] truncate text-xs text-muted" title={`${c.formula}\nrules: ${c.rule_ids.join(', ')}\n${c.position ?? ''}`}>
                    {c.formula}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'glass' && (
          <table className="dense" data-testid="glass-list">
            <thead>
              <tr>
                <th>Mark</th>
                <th>Field</th>
                <th>Type</th>
                <th>Description</th>
                <th className="num">W</th>
                <th className="num">H</th>
                <th className="num">Area</th>
                <th className="num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {r.glass_items.map((g) => (
                <tr key={g.mark}>
                  <td className="font-mono font-medium">{g.mark}</td>
                  <td className="font-mono text-xs text-muted">{g.field_key}</td>
                  <td className="capitalize">{g.fill_type}</td>
                  <td className="max-w-[260px] truncate text-xs" title={g.formula}>
                    {g.description}
                  </td>
                  <td className="num">{fmtMm(g.width)}</td>
                  <td className="num">{fmtMm(g.height)}</td>
                  <td className="num">{g.area_m2.toFixed(3)}</td>
                  <td className="num">{g.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'bom' && (
          <table className="dense" data-testid="bom-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Code</th>
                <th>Description</th>
                <th className="num">Quantity</th>
                <th>Rule</th>
              </tr>
            </thead>
            <tbody>
              {r.bom.map((b, i) => (
                <tr key={i}>
                  <td className="capitalize text-muted">{b.item_type}</td>
                  <td className="font-mono text-xs">{b.code}</td>
                  <td className="max-w-[340px] truncate" title={b.description}>
                    {b.description}
                  </td>
                  <td className="num">{fmtQty(b.quantity, b.unit)}</td>
                  <td className="max-w-[260px] truncate font-mono text-2xs text-faint" title={b.rule_ids.join(', ')}>
                    {b.rule_ids.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'issues' && <IssueList issues={r.issues} onPick={onPickIssue} empty="No issues" testId="calc-issues" />}
        {tab === 'totals' && (
          <table className="dense">
            <tbody>
              {Object.entries(r.totals).map(([k, v]) => (
                <tr key={k}>
                  <td className="font-mono text-xs text-muted">{k}</td>
                  <td className="num">{fmtNum(v, Number.isInteger(v) ? 0 : 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        <select className="input h-7 w-[170px]" value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={invalid || !profiles.length} data-testid="send-profile-select">
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} ({p.pieces} pcs)
            </option>
          ))}
        </select>
        <Button variant="primary" icon={<Ruler className="h-3.5 w-3.5" />} onClick={sendToCutting} disabled={invalid || !profileId} data-testid="send-to-cutting">
          Send to 1D cutting
        </Button>
        <div className="mx-1 h-5 w-px bg-line" />
        <select className="input h-7 w-[150px]" value={groupKey} onChange={(e) => setGroupKey(e.target.value)} disabled={invalid || !groups.length}>
          {groups.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label} ({g.count})
            </option>
          ))}
        </select>
        <Button icon={<LayoutGrid className="h-3.5 w-3.5" />} onClick={sendToNesting} disabled={invalid || !groupKey}>
          Send to 2D nesting
        </Button>
        <div className="flex-1" />
        {be.reportsAvailable ? (
          <>
            <Button size="sm" icon={<FileDown className="h-3.5 w-3.5" />} disabled={!entry.runId || invalid} tip={entry.runId ? 'Calc report (PDF)' : 'Save the elevation and calculate to create a persisted run'} onClick={() => void download('pdf')}>
              PDF
            </Button>
            <Button size="sm" icon={<FileDown className="h-3.5 w-3.5" />} disabled={!entry.runId || invalid} tip={entry.runId ? 'Calc report (XLSX)' : 'Save the elevation and calculate to create a persisted run'} onClick={() => void download('xlsx')}>
              XLSX
            </Button>
          </>
        ) : (
          <ServerOnlyButton size="sm" icon={<FileDown className="h-3.5 w-3.5" />}>
            Report
          </ServerOnlyButton>
        )}
      </div>
    </div>
  );
}
