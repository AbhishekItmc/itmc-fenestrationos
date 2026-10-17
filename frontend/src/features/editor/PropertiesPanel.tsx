import { AlignHorizontalSpaceAround, Rows3, Columns3, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Elevation, FieldFill, FillType } from '../../api/types';
import { getColour, getGlassType, getPanelType, getProfile, getSeries, glassTypesForSeries } from '../../engine/catalogue';
import {
  addTransomAllBays,
  effectiveMullionProfileId,
  effectiveTransomProfileId,
  moveMullion,
  moveTransom,
  parseFillKey,
  removeMullion,
  removeTransom,
  resize,
  resolveFill,
  resolveRuleSet,
  setFill,
} from '../../engine/elevation';
import { fmtArea, fmtDim } from '../../lib/format';
import { useApp } from '../../store/app';
import { toast } from '../../store/toast';
import { Chip } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Field, LengthInput, Segmented, Select } from '../../ui/Field';
import { InDevTag } from '../../ui/InDev';
import { minFieldSize, mullionRange, splitBayColumns, splitFieldRows, transomRange } from './geometry';
import { useEditor } from './store';

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-b border-line px-3 py-3">
      <div className="mb-2 flex items-center">
        <div className="section-title flex-1">{title}</div>
        {right}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted">{k}</span>
      <span className="font-mono text-fg">{v}</span>
    </div>
  );
}

function useRun() {
  return (fn: (e: Elevation) => Elevation, label: string) => {
    const r = useEditor.getState().edit(fn, label);
    if (!r.ok) toast.error(`Cannot ${label}`, r.error);
    return r.ok;
  };
}

export function PropertiesPanel() {
  const { elevation: e, selection } = useEditor();
  if (!e) return null;
  return (
    <div className="text-sm" data-testid="properties-panel">
      {selection.kind === 'elevation' && <ElevationProps e={e} />}
      {selection.kind === 'mullion' && <MullionProps e={e} index={selection.index} />}
      {selection.kind === 'transom' && <TransomProps e={e} bay={selection.bay} index={selection.index} />}
      {selection.kind === 'fields' && <FieldProps e={e} keys={selection.keys} />}
    </div>
  );
}

function ElevationProps({ e }: { e: Elevation }) {
  const cat = useApp((s) => s.catalogue);
  const run = useRun();
  const series = getSeries(cat, e.system_id);
  const rs = resolveRuleSet(e, cat);
  const minF = minFieldSize(e, cat);
  const [anchorsText, setAnchorsText] = useState(e.anchor_levels.join(', '));
  const [anchorsKey, setAnchorsKey] = useState(e.anchor_levels.join(','));
  if (anchorsKey !== e.anchor_levels.join(',')) {
    setAnchorsKey(e.anchor_levels.join(','));
    setAnchorsText(e.anchor_levels.join(', '));
  }
  const mullionOpts = (series?.mullion_profile_ids ?? []).map((id) => ({ value: id, label: `${getProfile(cat, id)?.code ?? id} · ${getProfile(cat, id)?.face_width}×${getProfile(cat, id)?.depth}` }));
  const transomOpts = (series?.transom_profile_ids ?? []).map((id) => ({ value: id, label: `${getProfile(cat, id)?.code ?? id} · ${getProfile(cat, id)?.face_width}×${getProfile(cat, id)?.depth}` }));
  const glassOpts = glassTypesForSeries(cat, e.system_id).map((g) => ({ value: g.id, label: `${g.code} · ${g.thickness ?? '?'} mm` }));
  const colour = getColour(cat, e.colour_id);
  return (
    <>
      <Section title="Elevation">
        <Field label="Name">
          <input
            className="input"
            defaultValue={e.name}
            key={e.name}
            onBlur={(ev) => {
              const v = ev.target.value.trim();
              if (v && v !== e.name) run((el) => ({ ...el, name: v }), 'rename');
            }}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
            }}
            data-testid="prop-name"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width (axis)">
            <LengthInput value={e.width} min={300} max={100000} onCommit={(v) => run((el) => resize(el, v, null), 'resize width')} testId="prop-width" />
          </Field>
          <Field label="Height (axis)">
            <LengthInput value={e.height} min={300} max={50000} onCommit={(v) => run((el) => resize(el, null, v), 'resize height')} testId="prop-height" />
          </Field>
        </div>
        <div className="text-2xs text-faint">Resizing scales mullion, transom and anchor positions proportionally.</div>
        <Field label="Quantity">
          <input className="input input-num" type="number" min={1} value={e.quantity} onChange={(ev) => run((el) => ({ ...el, quantity: Math.max(1, Math.round(Number(ev.target.value) || 1)) }), 'set quantity')} onKeyDown={(ev) => ev.stopPropagation()} />
        </Field>
      </Section>
      <Section title="System" right={rs ? <Chip tone="prov" tip="approved: false — requires domain-expert approval">{rs.version}</Chip> : undefined}>
        <Field label="Series">
          <Select
            value={e.system_id ?? ''}
            placeholder="— select series —"
            options={cat.series.map((x) => ({ value: x.id, label: `${x.code} — ${x.name}` }))}
            onChange={(v) =>
              run((el) => {
                const ok = glassTypesForSeries(cat, v).some((g) => g.id === el.default_glass_type_id);
                return { ...el, system_id: v || null, mullion_profile_id: null, transom_profile_id: null, bays: el.bays.map((b) => ({ ...b, transom_profile_id: null })), default_glass_type_id: ok ? el.default_glass_type_id : null };
              }, 'change series')
            }
            testId="prop-series"
          />
        </Field>
        <Field label="Mullion profile" hint={`effective: ${getProfile(cat, effectiveMullionProfileId(e, cat))?.code ?? '—'}`}>
          <Select value={e.mullion_profile_id ?? ''} placeholder="series default" options={mullionOpts} onChange={(v) => run((el) => ({ ...el, mullion_profile_id: v || null }), 'set mullion profile')} disabled={!series} />
        </Field>
        <Field label="Transom profile" hint={`effective (bay 1): ${getProfile(cat, effectiveTransomProfileId(e, 0, cat))?.code ?? '—'}`}>
          <Select value={e.transom_profile_id ?? ''} placeholder="series default" options={transomOpts} onChange={(v) => run((el) => ({ ...el, transom_profile_id: v || null }), 'set transom profile')} disabled={!series} />
        </Field>
        <Field label="Colour" group>
          <div className="flex items-center gap-2">
            <span className="h-5 w-5 shrink-0 rounded-sm border border-line-strong" style={{ background: colour?.hex ?? 'transparent' }} />
            <Select value={e.colour_id ?? ''} placeholder="— none —" options={cat.colours.map((c) => ({ value: c.id, label: `${c.name}${c.surcharge_pct ? ` (+${c.surcharge_pct}%)` : ''}` }))} onChange={(v) => run((el) => ({ ...el, colour_id: v || null }), 'set colour')} />
          </div>
        </Field>
        <Field label="Default glass" hint="filtered by series glazing range">
          <Select value={e.default_glass_type_id ?? ''} placeholder="— none —" options={glassOpts} onChange={(v) => run((el) => ({ ...el, default_glass_type_id: v || null }), 'set default glass')} testId="prop-default-glass" />
        </Field>
        <Row k="Min field (rule set)" v={`${minF.minW} × ${minF.minH}`} />
        <Row k="Rule set" v={rs ? `${rs.id}` : '—'} />
      </Section>
      <Section title="Anchors & shape">
        <Field label="Anchor levels (mm, comma separated)" hint="Demo input: brackets per anchor × mullions">
          <input
            className="input font-mono"
            value={anchorsText}
            onChange={(ev) => setAnchorsText(ev.target.value)}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
            }}
            onBlur={() => {
              const parts = anchorsText.split(/[,;\s]+/).filter(Boolean);
              const vals = parts.map(Number);
              if (vals.some((v) => !Number.isFinite(v))) return toast.error('Invalid anchor levels', 'Enter numbers separated by commas');
              const sorted = [...vals].sort((a, b) => a - b);
              if (sorted.join(',') !== e.anchor_levels.join(',')) run((el) => ({ ...el, anchor_levels: sorted }), 'set anchor levels');
            }}
          />
        </Field>
        <Field label="Top shape" group>
          <Segmented
            value={e.top_shape?.type ?? 'flat'}
            onChange={(v) => run((el) => ({ ...el, top_shape: v === 'arch' ? { type: 'arch', rise: Math.round(Math.min(600, el.width / 4)) } : { type: 'flat' } }), 'set top shape')}
            options={[
              { value: 'flat', label: 'Flat' },
              { value: 'arch', label: 'Segmental arch', tip: 'Geometry/display only — calculation not supported in v1' },
            ]}
            testId="prop-top-shape"
          />
        </Field>
        {e.top_shape?.type === 'arch' && (
          <>
            <Field label="Arch rise">
              <LengthInput value={e.top_shape.rise} min={1} max={e.width / 2} onCommit={(v) => run((el) => ({ ...el, top_shape: { type: 'arch', rise: v } }), 'set arch rise')} />
            </Field>
            <div className="rounded border border-prov/40 bg-prov/10 px-2 py-1.5 text-2xs text-prov">Arch: geometry only — member and glass calculation is not supported (ARCH_CALC_UNSUPPORTED).</div>
          </>
        )}
      </Section>
    </>
  );
}

function MullionProps({ e, index }: { e: Elevation; index: number }) {
  const cat = useApp((s) => s.catalogue);
  const run = useRun();
  const setSelection = useEditor((s) => s.setSelection);
  const internal = index > 0 && index < e.mullions.length - 1;
  const minF = minFieldSize(e, cat);
  const r = internal ? mullionRange(e, index, minF.minW) : null;
  const prof = getProfile(cat, effectiveMullionProfileId(e, cat));
  return (
    <Section title={`Mullion M${index + 1}`} right={<Chip tone={internal ? 'accent' : 'neutral'}>{internal ? 'internal' : 'edge'}</Chip>}>
      <Field label="Position x (centre line)" hint={r ? `allowed ${fmtDim(r.lo)} … ${fmtDim(r.hi)} (min field ${minF.minW})${r.relaxed ? ' — relaxed: geometry already violates min' : ''}` : 'Edge mullions follow the overall width'}>
        <LengthInput value={e.mullions[index]} disabled={!internal} min={r?.lo} max={r?.hi} onCommit={(v) => run((el) => moveMullion(el, index, v), 'move mullion')} testId="prop-mullion-x" />
      </Field>
      {index > 0 && <Row k={`Bay ${index} width`} v={fmtDim(e.mullions[index] - e.mullions[index - 1])} />}
      {index < e.mullions.length - 1 && <Row k={`Bay ${index + 1} width`} v={fmtDim(e.mullions[index + 1] - e.mullions[index])} />}
      <Row k="Profile" v={prof ? prof.code : '—'} />
      <Row k="Face × depth" v={prof ? `${prof.face_width} × ${prof.depth}` : '—'} />
      <Row k="Length (axis)" v={fmtDim(e.height)} />
      <div className="flex gap-2 pt-1">
        <Button size="sm" icon={<AlignHorizontalSpaceAround className="h-3.5 w-3.5" />} disabled={!internal} onClick={() => run((el) => moveMullion(el, index, (el.mullions[index - 1] + el.mullions[index + 1]) / 2), 'centre mullion')}>
          Centre
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          disabled={!internal}
          tip={internal ? 'Delete (Del) — bays merge, left fills kept' : 'Edge mullions cannot be deleted'}
          onClick={() => {
            if (run((el) => removeMullion(el, index), 'delete mullion')) setSelection({ kind: 'elevation' });
          }}
          data-testid="prop-delete-mullion"
        >
          Delete
        </Button>
      </div>
    </Section>
  );
}

function TransomProps({ e, bay, index }: { e: Elevation; bay: number; index: number }) {
  const cat = useApp((s) => s.catalogue);
  const run = useRun();
  const setSelection = useEditor((s) => s.setSelection);
  const minF = minFieldSize(e, cat);
  const tr = e.bays[bay].transoms;
  const y = tr[index];
  const r = transomRange(e, bay, index, minF.minH);
  const series = getSeries(cat, e.system_id);
  const opts = (series?.transom_profile_ids ?? []).map((id) => ({ value: id, label: getProfile(cat, id)?.code ?? id }));
  const below = y - (index > 0 ? tr[index - 1] : 0);
  const above = (index + 1 < tr.length ? tr[index + 1] : e.height) - y;
  return (
    <Section title={`Transom · bay ${bay + 1} · T${index + 1}`}>
      <Field label="Height y (centre line)" hint={`allowed ${fmtDim(r.lo)} … ${fmtDim(r.hi)} (min field ${minF.minH})`}>
        <LengthInput value={y} min={r.lo} max={r.hi} onCommit={(v) => run((el) => moveTransom(el, bay, index, v), 'move transom')} testId="prop-transom-y" />
      </Field>
      <Row k="Field below" v={fmtDim(below)} />
      <Row k="Field above" v={fmtDim(above)} />
      <Field label="Transom profile for this bay" hint={`effective: ${getProfile(cat, effectiveTransomProfileId(e, bay, cat))?.code ?? '—'}`}>
        <Select value={e.bays[bay].transom_profile_id ?? ''} placeholder="elevation default" options={opts} onChange={(v) => run((el) => ({ ...el, bays: el.bays.map((b, i) => (i === bay ? { ...b, transom_profile_id: v || null } : b)) }), 'set bay transom profile')} />
      </Field>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" icon={<Rows3 className="h-3.5 w-3.5" />} onClick={() => run((el) => addTransomAllBays(el, y), 'align transom across bays')} tip="Add a transom at this height in every other bay">
          Apply to all bays
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => {
            if (run((el) => removeTransom(el, bay, index), 'delete transom')) setSelection({ kind: 'elevation' });
          }}
          data-testid="prop-delete-transom"
        >
          Delete
        </Button>
      </div>
    </Section>
  );
}

const FILL_OPTS: { value: FillType; label: string }[] = [
  { value: 'glass', label: 'Glass' },
  { value: 'spandrel', label: 'Spandrel' },
  { value: 'panel', label: 'Panel' },
  { value: 'none', label: 'None' },
  { value: 'opening', label: 'Vent' },
];

function FieldProps({ e, keys }: { e: Elevation; keys: string[] }) {
  const cat = useApp((s) => s.catalogue);
  const run = useRun();
  const { splitN, splitDir, set } = useEditor();
  const fills = keys.map((k) => resolveFill(e, k));
  const types = new Set(fills.map((f) => f.type));
  const type = types.size === 1 ? fills[0].type : null;
  const rs = resolveRuleSet(e, cat);
  const gdx = rs?.params.glass_deduction_x;
  const gdy = rs?.params.glass_deduction_y;
  const glassOpts = glassTypesForSeries(cat, e.system_id);
  const applyAll = (fn: (f: FieldFill) => FieldFill, label: string) =>
    run((el) => keys.reduce((acc, k) => {
      const pk = parseFillKey(k)!;
      return setFill(acc, pk[0], pk[1], fn(resolveFill(acc, k)));
    }, el), label);
  const setType = (t: FillType) =>
    applyAll((f) => {
      if (t === 'glass') return { type: 'glass', glass_type_id: f.type === 'glass' ? f.glass_type_id : e.default_glass_type_id ?? null };
      if (t === 'spandrel') return { type: 'spandrel', glass_type_id: glassOpts.find((g) => g.category === 'spandrel')?.id ?? null };
      if (t === 'panel') return { type: 'panel', panel_type_id: f.panel_type_id ?? cat.panel_types[0]?.id ?? null };
      return { type: t };
    }, `set fill ${t}`);
  const single = keys.length === 1 ? parseFillKey(keys[0]) : null;
  const rects = keys.map((k) => {
    const [b, f] = parseFillKey(k)!;
    const ys = [0, ...e.bays[b].transoms, e.height];
    return { k, b, f, w: e.mullions[b + 1] - e.mullions[b], h: ys[f + 1] - ys[f] };
  });
  return (
    <>
      <Section title={keys.length === 1 ? `Field B${single![0] + 1}·F${single![1] + 1}` : `${keys.length} fields selected`} right={keys.length > 1 ? <span className="text-2xs text-faint">shift-click to add/remove</span> : undefined}>
        <Field label="Fill type" group>
          <Segmented value={(type ?? '') as FillType} onChange={setType} options={FILL_OPTS} testId="prop-fill-type" />
        </Field>
        {type === 'opening' && (
          <div className="flex items-center gap-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs text-warn">
            Vent / opening sash: geometry marker only. <InDevTag />
          </div>
        )}
        {(type === 'glass' || type === 'spandrel') && (
          <Field label={type === 'glass' ? 'Glass type' : 'Spandrel glass'} hint="Compatible with series glazing range (demo rule)">
            <Select
              value={types.size === 1 && new Set(fills.map((f) => f.glass_type_id)).size === 1 ? (fills[0].glass_type_id ?? '') : ''}
              placeholder={type === 'glass' ? 'elevation default' : '— select —'}
              options={glassOpts.filter((g) => (type === 'spandrel' ? true : g.category !== 'spandrel')).map((g) => ({ value: g.id, label: `${g.code} · ${g.thickness ?? '?'} mm${g.category === 'fire' ? ' · rating not supplied' : ''}` }))}
              onChange={(v) => applyAll((f) => ({ ...f, glass_type_id: v || null }), 'set glass type')}
              testId="prop-glass-type"
            />
          </Field>
        )}
        {type === 'panel' && (
          <Field label="Panel type">
            <Select value={fills[0].panel_type_id ?? ''} placeholder="— select —" options={cat.panel_types.map((p) => ({ value: p.id, label: `${p.code} · ${p.thickness ?? '?'} mm` }))} onChange={(v) => applyAll((f) => ({ ...f, panel_type_id: v || null }), 'set panel type')} />
          </Field>
        )}
      </Section>
      <Section title="Computed sizes (provisional)">
        <div className="max-h-[220px] space-y-1.5 overflow-auto">
          {rects.map((r) => {
            const f = resolveFill(e, r.k);
            const gw = gdx !== undefined ? r.w - gdx : null;
            const gh = gdy !== undefined ? r.h - gdy : null;
            const g = getGlassType(cat, f.glass_type_id);
            const p = getPanelType(cat, f.panel_type_id);
            return (
              <div key={r.k} className="rounded border border-line bg-bg/40 px-2 py-1.5">
                <div className="mb-0.5 flex items-center justify-between text-2xs">
                  <span className="font-mono text-muted">
                    B{r.b + 1}·F{r.f + 1}
                  </span>
                  <span className="truncate pl-2 text-faint">{f.type === 'panel' ? p?.code : f.type === 'glass' || f.type === 'spandrel' ? g?.code ?? 'type ?' : f.type}</span>
                </div>
                <Row k="Axis W × H" v={`${fmtDim(r.w)} × ${fmtDim(r.h)}`} />
                {(f.type === 'glass' || f.type === 'spandrel' || f.type === 'panel') && gw !== null && gh !== null && (
                  <>
                    <Row k="Fill size" v={`${fmtDim(gw)} × ${fmtDim(gh)}`} />
                    <Row k="Area" v={fmtArea((gw * gh) / 1e6, 3)} />
                  </>
                )}
              </div>
            );
          })}
        </div>
        {gdx !== undefined && <div className="text-2xs text-faint">Fill = axis − glass_deduction ({gdx}/{gdy} mm, DEMO rule {rs?.id}).</div>}
      </Section>
      {single && (
        <Section title="Split field equally">
          <div className="flex items-center gap-2">
            <input className="input input-num w-16" type="number" min={2} max={12} value={splitN} onChange={(ev) => set({ splitN: Math.max(2, Math.min(12, Math.round(Number(ev.target.value) || 2))) })} onKeyDown={(ev) => ev.stopPropagation()} data-testid="prop-split-n" />
            <Segmented
              value={splitDir}
              onChange={(v) => set({ splitDir: v })}
              options={[
                { value: 'rows', label: <Rows3 className="h-3.5 w-3.5" />, tip: 'Rows (transoms in this bay)' },
                { value: 'cols', label: <Columns3 className="h-3.5 w-3.5" />, tip: 'Columns (full-height mullions)' },
              ]}
            />
            <Button size="sm" onClick={() => run((el) => (splitDir === 'rows' ? splitFieldRows(el, single[0], single[1], splitN) : splitBayColumns(el, single[0], splitN)), `split into ${splitN}`)} data-testid="prop-split">
              Split
            </Button>
          </div>
          {splitDir === 'cols' && <div className="text-2xs text-faint">Columns insert full-height mullions across the whole bay.</div>}
        </Section>
      )}
    </>
  );
}
