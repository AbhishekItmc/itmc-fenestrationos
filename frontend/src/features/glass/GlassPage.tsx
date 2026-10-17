import clsx from 'clsx';
import { Check, Minus, X } from 'lucide-react';
import { useState } from 'react';
import type { Catalogue, CatGlassType, CatPanelType, CatSeries } from '../../api/types';
import { compatibilityRules } from '../../engine/catalogue';
import { fmtMoney, fmtNum } from '../../lib/format';
import { useApp } from '../../store/app';
import { Chip } from '../../ui/Badge';
import { PageHeader } from '../../ui/Misc';

type Cat = 'none' | 'single' | 'laminated' | 'igu' | 'spandrel' | 'fire' | 'special' | 'project' | 'panels';
const CATS: { id: Cat; label: string; blurb: string }[] = [
  { id: 'none', label: 'No glass', blurb: 'Open field (fill type “none”): no fill produced; perimeter members only.' },
  { id: 'single', label: 'Single glazing', blurb: 'Monolithic toughened lites.' },
  { id: 'laminated', label: 'Laminated', blurb: 'Two lites bonded with an interlayer (PVB/SGP).' },
  { id: 'igu', label: 'Insulating (IGU)', blurb: 'Double glazed units with spacer cavity.' },
  { id: 'spandrel', label: 'Spandrel', blurb: 'Opaque glass for slab / ceiling zones.' },
  { id: 'fire', label: 'Fire-resistant', blurb: 'Fire rating: NOT SUPPLIED in demo data — must come from a certified product.' },
  { id: 'special', label: 'Special', blurb: 'Acoustic, security or other special build-ups.' },
  { id: 'project', label: 'Project glass', blurb: 'Placeholder defined per project; size/thickness to be confirmed.' },
  { id: 'panels', label: 'Panels', blurb: 'ACP, aluminium sheet and insulated panels (fill type “panel”).' },
];

type Compat = 'ok' | 'no' | 'unknown';
function compat(cat: Catalogue, s: CatSeries, t: number | null): { state: Compat; why: string } {
  if (t == null) return { state: 'unknown', why: 'thickness not defined' };
  const ranges: [number, number][] = [];
  if (s.glass_thickness_min != null && s.glass_thickness_max != null) ranges.push([s.glass_thickness_min, s.glass_thickness_max]);
  for (const r of compatibilityRules(cat, s.id, 'glass_thickness_range')) ranges.push([r.params.min ?? 0, r.params.max ?? 1e9]);
  for (const [lo, hi] of ranges) if (t < lo || t > hi) return { state: 'no', why: `${t} mm outside ${lo}–${hi} mm` };
  return { state: 'ok', why: `${t} mm within glazing range` };
}

function BuildUp({ text, thickness }: { text: string; thickness: number | null }) {
  const parts = text.split('/').map((p) => p.trim());
  const layers = parts.map((p) => {
    const n = Number(/([\d.]+)/.exec(p)?.[1] ?? NaN);
    const kind = /air|argon|krypton/i.test(p) ? 'gap' : /pvb|sgp|interlayer/i.test(p) ? 'inter' : 'glass';
    return { p, n: Number.isFinite(n) ? n : 0, kind };
  });
  const total = layers.reduce((a, l) => a + l.n, 0) || thickness || 1;
  if (!layers.some((l) => l.n > 0)) return <div className="text-2xs text-faint">build-up: {text}</div>;
  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-sm border border-line">
        {layers.map((l, i) => (
          <div
            key={i}
            title={l.p}
            className={clsx('h-full border-r border-bg/60 last:border-r-0', l.kind === 'glass' ? 'bg-sky-300/45' : l.kind === 'gap' ? 'bg-transparent' : 'bg-amber-300/50')}
            style={{ width: `${(Math.max(l.n, total * 0.03) / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-1 font-mono text-2xs text-muted">{text}</div>
    </div>
  );
}

function CompatRow({ cat, t }: { cat: Catalogue; t: number | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {cat.series.map((s) => {
        const c = compat(cat, s, t);
        return (
          <span key={s.id} data-tip={c.why} className={clsx('inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-2xs font-medium', c.state === 'ok' ? 'border-ok/40 text-ok' : c.state === 'no' ? 'border-err/40 text-err' : 'border-line-strong text-faint')}>
            {c.state === 'ok' ? <Check className="h-3 w-3" /> : c.state === 'no' ? <X className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {s.code}
          </span>
        );
      })}
    </div>
  );
}

export default function GlassPage() {
  const cat = useApp((s) => s.catalogue);
  const [active, setActive] = useState<Cat>('igu');
  const cur = cat.currency ?? 'INR';
  const glass = (c: Cat) => cat.glass_types.filter((g) => g.category === c);
  const count = (c: Cat) => (c === 'none' ? 1 : c === 'panels' ? cat.panel_types.length : glass(c).length);
  const meta = CATS.find((c) => c.id === active)!;

  const glassCard = (g: CatGlassType) => (
    <div key={g.id} className="panel p-3" data-testid={`glass-card-${g.id}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-accent">{g.code}</div>
          <div className="mt-0.5 font-medium">{g.name}</div>
        </div>
        <Chip tone="prov">demo</Chip>
      </div>
      <div className="mt-3">{g.build_up ? <BuildUp text={g.build_up} thickness={g.thickness} /> : <div className="text-2xs text-faint">no build-up</div>}</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="section-title">Thickness</div>
          <div className="font-mono">{g.thickness == null ? '—' : `${g.thickness} mm`}</div>
        </div>
        <div>
          <div className="section-title">Weight</div>
          <div className="font-mono">{g.weight_kg_m2 == null ? '—' : `${fmtNum(g.weight_kg_m2, 1)} kg/m²`}</div>
        </div>
        <div>
          <div className="section-title">Price (demo)</div>
          <div className="font-mono">{g.price_per_m2 == null ? '—' : `${fmtMoney(g.price_per_m2, cur)}/m²`}</div>
        </div>
      </div>
      {g.category === 'fire' && <div className="mt-2 rounded-sm border border-warn/40 bg-warn/10 px-2 py-1 text-2xs text-warn">Fire rating: not supplied — selecting it raises FIRE_RATING_NOT_CERTIFIED.</div>}
      <div className="mt-3">
        <div className="section-title mb-1">Series compatibility</div>
        <CompatRow cat={cat} t={g.thickness} />
      </div>
    </div>
  );
  const panelCard = (p: CatPanelType) => (
    <div key={p.id} className="panel p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-accent">{p.code}</div>
          <div className="mt-0.5 font-medium">{p.name}</div>
        </div>
        <Chip tone="prov">demo</Chip>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="section-title">Category</div>
          <div>{p.category}</div>
        </div>
        <div>
          <div className="section-title">Thickness</div>
          <div className="font-mono">{p.thickness ?? '—'} mm</div>
        </div>
        <div>
          <div className="section-title">Price (demo)</div>
          <div className="font-mono">{p.price_per_m2 == null ? '—' : `${fmtMoney(p.price_per_m2, cur)}/m²`}</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="section-title mb-1">Glazing pocket fit</div>
        <CompatRow cat={cat} t={p.thickness} />
        <div className="mt-1 text-2xs text-faint">Thin panels outside the pocket range need packers/adaptors (warning, requires engineering approval).</div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col" data-testid="glass-page">
      <PageHeader title="Glass & Panels" subtitle="Fill configurations by category with demo thickness, weight, price and series compatibility" />
      <div className="flex min-h-0 flex-1">
        <nav className="w-[230px] shrink-0 overflow-auto border-r border-line bg-panel py-2">
          {CATS.map((c) => (
            <button key={c.id} onClick={() => setActive(c.id)} className={clsx('flex h-8 w-full items-center px-4 text-left text-sm', active === c.id ? 'bg-accent/10 text-fg' : 'text-muted hover:bg-hover hover:text-fg')}>
              <span className="flex-1">{c.label}</span>
              <span className="font-mono text-2xs text-faint">{count(c.id)}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto p-4">
          <div className="mb-3">
            <h2 className="text-lg font-semibold">{meta.label}</h2>
            <p className="text-sm text-muted">{meta.blurb}</p>
          </div>
          {active === 'none' ? (
            <div className="panel max-w-xl p-4 text-sm text-muted">
              Set a field’s fill type to <b className="text-fg">None</b> in the elevation editor (key <span className="kbd">4</span>). No glass item, gasket or setting blocks are produced for it; it is drawn with a crossed outline.
            </div>
          ) : active === 'panels' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3">{cat.panel_types.map(panelCard)}</div>
          ) : glass(active).length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3">{glass(active).map(glassCard)}</div>
          ) : (
            <div className="text-sm text-faint">No demo types in this category.</div>
          )}
        </div>
      </div>
    </div>
  );
}
