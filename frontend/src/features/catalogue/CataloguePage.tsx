import { Pencil, Save, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../../api/client';
import type { CatalogueCollection, CatProfile, CatRuleSet } from '../../api/types';
import { getProfile, getSeries } from '../../engine/catalogue';
import { fmtMoney, fmtNum } from '../../lib/format';
import { canWrite, useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { Chip } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Drawer } from '../../ui/Dialog';
import { ServerOnlyButton } from '../../ui/InDev';
import { EmptyState, PageHeader, Tabs } from '../../ui/Misc';

type Row = Record<string, unknown> & { id: string };
interface Col {
  key: string;
  label: string;
  num?: boolean;
  render?: (r: Row) => ReactNode;
}

export function ProfileSchematic({ p, size = 180 }: { p: CatProfile; size?: number }) {
  const k = (size - 60) / Math.max(p.face_width, p.depth);
  const w = p.face_width * k;
  const d = p.depth * k;
  const x0 = (size - w) / 2;
  const y0 = (size - d) / 2 - 6;
  return (
    <figure className="flex flex-col items-center">
      <svg width={size} height={size} className="rounded border border-line bg-[#0b0e12]">
        <defs>
          <pattern id="sch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(148,163,184,0.25)" />
          </pattern>
        </defs>
        <rect x={x0} y={y0} width={w} height={d} fill="url(#sch)" stroke="#aeb8c5" strokeWidth={1.2} strokeDasharray="5 3" />
        <line x1={x0} y1={y0 + d + 12} x2={x0 + w} y2={y0 + d + 12} stroke="#8fa1b5" />
        <text x={x0 + w / 2} y={y0 + d + 25} fontSize={10} fill="#d5dde6" textAnchor="middle" fontFamily="JetBrains Mono">
          {p.face_width}
        </text>
        <line x1={x0 - 12} y1={y0} x2={x0 - 12} y2={y0 + d} stroke="#8fa1b5" />
        <text x={x0 - 16} y={y0 + d / 2} fontSize={10} fill="#d5dde6" textAnchor="middle" fontFamily="JetBrains Mono" transform={`rotate(-90 ${x0 - 16} ${y0 + d / 2})`}>
          {p.depth}
        </text>
        <text x={size / 2} y={size - 6} fontSize={8.5} fill="#f5b428" textAnchor="middle">
          schematic – not manufacturer section
        </text>
      </svg>
      <figcaption className="mt-1 text-2xs text-faint">face width × depth (mm), bounding box only</figcaption>
    </figure>
  );
}

const TABS: { value: CatalogueCollection; label: string }[] = [
  { value: 'series', label: 'Series' },
  { value: 'profiles', label: 'Profiles' },
  { value: 'glass_types', label: 'Glass' },
  { value: 'panel_types', label: 'Panels' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'colours', label: 'Colours' },
  { value: 'rule_sets', label: 'Rule sets' },
  { value: 'compatibility', label: 'Compatibility' },
];

export default function CataloguePage() {
  const { catalogue: cat, user, catalogueSource } = useApp();
  const be = useBackend();
  const [tab, setTab] = useState<CatalogueCollection>('series');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Row | null>(null);
  const cur = cat.currency ?? 'INR';
  const seriesCode = (id: unknown) => getSeries(cat, String(id ?? ''))?.code ?? String(id ?? '—');

  const cols: Record<CatalogueCollection, Col[]> = {
    series: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'system_type', label: 'System type' },
      { key: 'face_width', label: 'Face', num: true },
      { key: 'glass', label: 'Glazing range', render: (r) => `${r.glass_thickness_min ?? '?'}–${r.glass_thickness_max ?? '?'} mm` },
      { key: 'default_rule_set_id', label: 'Rule set' },
    ],
    profiles: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'series_id', label: 'Series', render: (r) => seriesCode(r.series_id) },
      { key: 'face_width', label: 'Face', num: true },
      { key: 'depth', label: 'Depth', num: true },
      { key: 'weight_kg_m', label: 'kg/m', num: true },
      { key: 'stock_lengths', label: 'Stock lengths', render: (r) => (r.stock_lengths as number[]).join(' / ') },
      { key: 'price_per_m', label: `Price/m (${cur})`, num: true, render: (r) => fmtNum(Number(r.price_per_m), 0) },
    ],
    glass_types: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'build_up', label: 'Build-up' },
      { key: 'thickness', label: 'Thk', num: true },
      { key: 'weight_kg_m2', label: 'kg/m²', num: true },
      { key: 'price_per_m2', label: `Price/m² (${cur})`, num: true, render: (r) => (r.price_per_m2 == null ? '—' : fmtNum(Number(r.price_per_m2), 0)) },
      { key: 'fire_rating', label: 'Fire rating', render: (r) => (r.category === 'fire' ? <Chip tone="warn">not supplied</Chip> : '—') },
    ],
    panel_types: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'thickness', label: 'Thk', num: true },
      { key: 'price_per_m2', label: `Price/m² (${cur})`, num: true, render: (r) => fmtNum(Number(r.price_per_m2), 0) },
    ],
    accessories: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'kind', label: 'Kind' },
      { key: 'unit', label: 'Unit' },
      { key: 'price', label: `Price (${cur})`, num: true, render: (r) => fmtNum(Number(r.price), 0) },
      { key: 'series_ids', label: 'Series', render: (r) => (r.series_ids as string[]).map(seriesCode).join(', ') },
    ],
    colours: [
      { key: 'hex', label: '', render: (r) => <span className="inline-block h-3.5 w-6 rounded-sm border border-line-strong" style={{ background: String(r.hex) }} /> },
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'finish', label: 'Finish' },
      { key: 'surcharge_pct', label: 'Surcharge %', num: true },
    ],
    rule_sets: [
      { key: 'id', label: 'Id' },
      { key: 'series_id', label: 'Series', render: (r) => seriesCode(r.series_id) },
      { key: 'version', label: 'Version' },
      { key: 'approved', label: 'Approval', render: (r) => (r.approved ? <Chip tone="ok">approved</Chip> : <Chip tone="prov">approved: false</Chip>) },
      { key: 'params', label: 'Params', num: true, render: (r) => Object.keys(r.params as object).length },
    ],
    compatibility: [
      { key: 'id', label: 'Id' },
      { key: 'kind', label: 'Kind' },
      { key: 'series_id', label: 'Series', render: (r) => seriesCode(r.series_id) },
      { key: 'params', label: 'Params', render: (r) => <span className="font-mono text-xs">{JSON.stringify(r.params)}</span> },
      { key: 'message', label: 'Message' },
    ],
  };

  const rows = useMemo(() => {
    const list = (cat[tab] as unknown as Row[]) ?? [];
    const s = q.trim().toLowerCase();
    return s ? list.filter((r) => JSON.stringify(r).toLowerCase().includes(s)) : list;
  }, [cat, tab, q]);

  return (
    <div className="flex h-full flex-col" data-testid="catalogue-page">
      <PageHeader
        title="Catalogue"
        subtitle={
          <span>
            <span className="font-mono">{cat.catalogue_version}</span> · {catalogueSource === 'server' ? 'served by the API' : 'bundled demo copy'} · <span className="text-prov">{cat.disclaimer}</span>
          </span>
        }
      >
        <div className="mt-3 flex items-end gap-3">
          <Tabs value={tab} onChange={(v) => { setTab(v); setSel(null); }} tabs={TABS.map((t) => ({ ...t, count: (cat[t.value] as unknown[]).length }))} className="flex-1 border-b-0" />
          <div className="relative mb-1 w-[260px]">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input className="input pl-7" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        {!rows.length ? (
          <EmptyState title="Nothing matches" />
        ) : (
          <table className="dense" data-testid="catalogue-table">
            <thead>
              <tr>
                {cols[tab].map((c) => (
                  <th key={c.key} className={c.num ? 'num' : undefined}>
                    {c.label}
                  </th>
                ))}
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`cursor-pointer ${sel?.id === r.id ? 'selected' : ''}`} onClick={() => setSel(r)}>
                  {cols[tab].map((c) => (
                    <td key={c.key} className={c.num ? 'num' : c.key === 'code' || c.key === 'id' ? 'font-mono text-xs' : undefined}>
                      {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                    </td>
                  ))}
                  <td>{r.demo !== false && tab !== 'compatibility' ? <Chip tone="prov">demo</Chip> : <Chip>rule</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Drawer open={!!sel} onClose={() => setSel(null)} title={String(sel?.code ?? sel?.id ?? '')} subtitle={String(sel?.name ?? sel?.kind ?? '')} width={600} testId="catalogue-drawer">
        {sel && <Detail row={sel} collection={tab} canEdit={be.canEditCatalogue && canWrite(user, 'admin')} />}
      </Drawer>
    </div>
  );
}

function Detail({ row, collection, canEdit }: { row: Row; collection: CatalogueCollection; canEdit: boolean }) {
  const { catalogue: cat, setCatalogue, mode } = useApp();
  const be = useBackend();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Row>(row);
  const [busy, setBusy] = useState(false);
  const isRule = collection === 'rule_sets';
  const scalarKeys = Object.keys(row).filter((k) => ['string', 'number'].includes(typeof row[k]) && k !== 'id' && k !== 'notes' && k !== 'description');

  const save = async () => {
    setBusy(true);
    try {
      await be.updateCatalogueItem(collection, row.id, draft);
      setCatalogue(await be.getCatalogue(), 'server');
      toast.success('Catalogue item saved', `${row.id} — new catalogue revision (audited)`);
      setEditing(false);
    } catch (e) {
      toast.error('Save failed', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const profile = collection === 'profiles' ? getProfile(cat, row.id) : null;
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Chip tone="prov">DEMO DATA — not manufacturer data</Chip>
        <div className="flex-1" />
        {canEdit ? (
          editing ? (
            <>
              <Button size="sm" onClick={() => { setDraft(row); setEditing(false); }}>
                Cancel
              </Button>
              <Button size="sm" variant="solid" icon={<Save className="h-3.5 w-3.5" />} loading={busy} onClick={() => void save()}>
                Save (PUT)
              </Button>
            </>
          ) : (
            <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)} data-testid="catalogue-edit">
              Edit
            </Button>
          )
        ) : mode === 'offline' ? (
          <ServerOnlyButton size="sm" icon={<Pencil className="h-3.5 w-3.5" />}>
            Edit
          </ServerOnlyButton>
        ) : (
          <span className="text-2xs text-faint">Editing requires the admin role</span>
        )}
      </div>
      {profile && <ProfileSchematic p={profile} />}
      {isRule && <RuleSetParams rs={draft as unknown as CatRuleSet} editing={editing} onChange={(params) => setDraft({ ...draft, params })} />}
      <table className="dense">
        <tbody>
          {scalarKeys.map((k) => (
            <tr key={k}>
              <td className="w-[180px] font-mono text-xs text-muted">{k}</td>
              <td>
                {editing && !isRule ? (
                  <input
                    className={`input h-6 ${typeof row[k] === 'number' ? 'input-num' : ''}`}
                    value={String(draft[k] ?? '')}
                    onChange={(e) => setDraft({ ...draft, [k]: typeof row[k] === 'number' ? Number(e.target.value) : e.target.value })}
                  />
                ) : collection === 'colours' && k === 'hex' ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-4 w-8 rounded-sm border border-line-strong" style={{ background: String(row.hex) }} />
                    <span className="font-mono text-xs">{String(row.hex)}</span>
                  </span>
                ) : k.startsWith('price') ? (
                  <span className="font-mono">{fmtMoney(Number(row[k]), cat.currency ?? 'INR')} <span className="text-2xs text-prov">demo price</span></span>
                ) : (
                  <span className="font-mono text-xs">{String(row[k])}</span>
                )}
              </td>
            </tr>
          ))}
          {Object.keys(row)
            .filter((k) => Array.isArray(row[k]))
            .map((k) => (
              <tr key={k}>
                <td className="font-mono text-xs text-muted">{k}</td>
                <td className="font-mono text-xs">{(row[k] as unknown[]).join(', ') || '—'}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {typeof row.notes === 'string' && <p className="text-xs text-faint">{row.notes}</p>}
      {typeof row.description === 'string' && <p className="text-xs text-muted">{row.description}</p>}
    </div>
  );
}

function RuleSetParams({ rs, editing, onChange }: { rs: CatRuleSet; editing: boolean; onChange: (p: Record<string, number>) => void }) {
  return (
    <div>
      <div className="mb-2 rounded border border-prov/50 bg-prov/10 px-3 py-2 text-xs text-prov" data-testid="ruleset-approval">
        <b>approved: {String(rs.approved)}</b> — requires domain-expert approval. golden_cases_passed: {String(rs.golden_cases_passed ?? false)}. Results computed with this rule set are PROVISIONAL.
      </div>
      <table className="dense">
        <thead>
          <tr>
            <th>Parameter</th>
            <th className="num">Value</th>
            <th>Meaning — source</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(rs.params).map(([k, v]) => (
            <tr key={k}>
              <td className="font-mono text-xs">{k}</td>
              <td className="num w-[110px]">
                {editing ? <input className="input input-num h-6" value={v} onChange={(e) => onChange({ ...rs.params, [k]: Number(e.target.value) })} /> : fmtNum(v, Number.isInteger(v) ? 0 : 2)}
              </td>
              <td className="!whitespace-normal text-xs text-muted">{rs.param_docs[k] ?? <span className="text-err">undocumented</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
