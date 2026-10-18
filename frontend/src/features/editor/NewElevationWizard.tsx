import { Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Elevation } from '../../api/types';
import { getRuleSet, getSeries, glassTypesForSeries } from '../../engine/catalogue';
import { makeGrid } from '../../engine/elevation';
import { fmtDim } from '../../lib/format';
import { useApp } from '../../store/app';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, LengthInput, Select, Toggle } from '../../ui/Field';
import { TEMPLATES } from './templates';

export function NewElevationWizard({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (e: Elevation, saveToProject: boolean) => void }) {
  const { catalogue: cat, projectId, projects } = useApp();
  const [name, setName] = useState('New elevation');
  const [W, setW] = useState(4500);
  const [H, setH] = useState(3600);
  const [bays, setBays] = useState(3);
  const [rows, setRows] = useState(2);
  const [series, setSeries] = useState('ser-cw50');
  const [glass, setGlass] = useState('gl-dgu-24');
  const [colour, setColour] = useState('col-ral7016');
  const [qty, setQty] = useState(1);
  const [anchors, setAnchors] = useState(true);
  const [save, setSave] = useState(true);
  const s = getSeries(cat, series);
  const rs = getRuleSet(cat, s?.default_rule_set_id);
  const minW = rs?.params.min_field_width ?? 100;
  const minH = rs?.params.min_field_height ?? 100;
  const maxW = rs?.params.max_field_width;
  const maxH = rs?.params.max_field_height;
  const glassOptions = useMemo(() => glassTypesForSeries(cat, series), [cat, series]);

  const errors: string[] = [];
  if (!name.trim()) errors.push('Name is required');
  if (!(bays >= 1 && bays <= 40 && Number.isInteger(bays))) errors.push('Bays must be 1–40');
  if (!(rows >= 1 && rows <= 20 && Number.isInteger(rows))) errors.push('Rows must be 1–20');
  if (W / bays < minW) errors.push(`Bay width ${fmtDim(W / bays)} < rule-set minimum ${minW} mm`);
  if (H / rows < minH) errors.push(`Row height ${fmtDim(H / rows)} < rule-set minimum ${minH} mm`);
  const warnings: string[] = [];
  if (maxW && W / bays > maxW) warnings.push(`Bay width ${fmtDim(W / bays)} exceeds max field width ${maxW} mm (will show as validation error)`);
  if (maxH && H / rows > maxH) warnings.push(`Row height ${fmtDim(H / rows)} exceeds max field height ${maxH} mm`);

  const build = (): Elevation =>
    makeGrid(W, H, bays, rows, { name: name.trim(), system_id: series, default_glass_type_id: glass || null, colour_id: colour || null, quantity: qty, anchor_levels: anchors ? [0, H] : [] });

  // preview
  const pw = 220;
  const ph = 150;
  const k = Math.min(pw / W, ph / H);
  const project = projects.find((p) => p.id === projectId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={760}
      testId="new-elevation-wizard"
      title="New elevation"
      subtitle="Equal-spacing grid; refine positions in the editor afterwards. Minimum sizes come from the series' DEMO rule set."
      footer={
        <>
          {project ? <Toggle checked={save} onChange={setSave} label={<span className="text-xs text-muted">Save to {project.code} now</span>} /> : <span className="text-xs text-faint">No project selected — elevation stays unsaved until you save it into a project.</span>}
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid" icon={<Wand2 className="h-3.5 w-3.5" />} disabled={errors.length > 0} onClick={() => onCreate(build(), !!project && save)} data-testid="wizard-create">
            Create elevation
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_250px] gap-5">
        <div className="space-y-3">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="wizard-name" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Width (axis)">
              <LengthInput value={W} onCommit={setW} min={300} max={60000} testId="wizard-width" />
            </Field>
            <Field label="Height (axis)">
              <LengthInput value={H} onCommit={setH} min={300} max={30000} testId="wizard-height" />
            </Field>
            <Field label="Bays">
              <input className="input input-num" type="number" min={1} max={40} value={bays} onChange={(e) => setBays(Number(e.target.value))} data-testid="wizard-bays" />
            </Field>
            <Field label="Rows per bay">
              <input className="input input-num" type="number" min={1} max={20} value={rows} onChange={(e) => setRows(Number(e.target.value))} data-testid="wizard-rows" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Series (system)">
              <Select
                value={series}
                onChange={(v) => {
                  setSeries(v);
                  if (!glassTypesForSeries(cat, v).some((g) => g.id === glass)) setGlass('');
                }}
                options={cat.series.map((x) => ({ value: x.id, label: `${x.code} — ${x.name}` }))}
                testId="wizard-series"
              />
            </Field>
            <Field label="Default glass" hint="filtered by series glazing range">
              <Select value={glass} onChange={setGlass} placeholder="— none —" options={glassOptions.map((g) => ({ value: g.id, label: `${g.code} · ${g.thickness ?? '?'} mm` }))} />
            </Field>
            <Field label="Colour">
              <Select value={colour} onChange={setColour} placeholder="— none —" options={cat.colours.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="Quantity">
              <input className="input input-num" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
            </Field>
          </div>
          <Toggle checked={anchors} onChange={setAnchors} label={<span className="text-sm">Anchor brackets at sill and head (demo input)</span>} />
          {errors.map((m) => (
            <div key={m} className="text-xs text-err">
              {m}
            </div>
          ))}
          {warnings.map((m) => (
            <div key={m} className="text-xs text-warn">
              {m}
            </div>
          ))}
        </div>
        <div>
          <div className="label">Preview</div>
          <div className="flex h-[190px] items-center justify-center rounded border border-line bg-[var(--cad-bg)]">
            <svg width={pw + 20} height={ph + 20}>
              <g transform={`translate(${10 + (pw - W * k) / 2} ${10 + (ph - H * k) / 2})`}>
                <rect width={W * k} height={H * k} fill="var(--cad-glass)" stroke="var(--cad-member)" strokeWidth={2} />
                {Array.from({ length: Math.max(0, bays - 1) }, (_, i) => (
                  <line key={i} x1={((i + 1) * W * k) / bays} y1={0} x2={((i + 1) * W * k) / bays} y2={H * k} stroke="var(--cad-member)" strokeWidth={1.5} />
                ))}
                {Array.from({ length: Math.max(0, rows - 1) }, (_, j) => (
                  <line key={j} x1={0} y1={((j + 1) * H * k) / rows} x2={W * k} y2={((j + 1) * H * k) / rows} stroke="var(--cad-member)" strokeWidth={1.2} />
                ))}
              </g>
            </svg>
          </div>
          <div className="mt-2 space-y-0.5 font-mono text-2xs text-muted">
            <div>
              bay ≈ {fmtDim(W / Math.max(1, bays))} · row ≈ {fmtDim(H / Math.max(1, rows))}
            </div>
            <div>
              min field {minW}×{minH} · rule set {rs?.id ?? '—'}
            </div>
          </div>
          <div className="mt-4">
            <div className="label">Or start from a template</div>
            <div className="space-y-1">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="block w-full rounded border border-line px-2 py-1.5 text-left hover:border-accent/50 hover:bg-hover" onClick={() => onCreate(t.build(), !!project && save)} data-testid={`template-${t.id}`}>
                  <div className="text-xs font-medium">{t.name}</div>
                  <div className="text-2xs text-faint">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
