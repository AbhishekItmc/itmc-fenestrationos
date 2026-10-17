import clsx from 'clsx';
import { ChevronDown, ChevronRight, Columns3, Frame, Square } from 'lucide-react';
import { useState } from 'react';
import type { Elevation, FillType } from '../../api/types';
import { fillKey, resolveFill } from '../../engine/elevation';
import { fmtDim } from '../../lib/format';
import { useEditor } from './store';

const fillSwatch: Record<FillType, string> = {
  glass: 'bg-sky-400/40 border-sky-300/60',
  spandrel: 'bg-slate-500/60 border-slate-300/50',
  panel: 'bg-slate-400 border-slate-300',
  none: 'bg-transparent border-dashed border-faint',
  opening: 'bg-orange-400/20 border-dashed border-orange-400',
};

export function FillSwatch({ type }: { type: FillType }) {
  return <span className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-[1px] border', fillSwatch[type])} />;
}

export function TreePanel({ e }: { e: Elevation }) {
  const { selection, setSelection, toggleField } = useEditor();
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const selKeys = selection.kind === 'fields' ? selection.keys : [];
  return (
    <div className="text-xs" data-testid="elevation-tree">
      <button className={clsx('flex h-7 w-full items-center gap-1.5 px-2 text-left hover:bg-hover', selection.kind === 'elevation' && 'bg-accent/10 text-fg')} onClick={() => setSelection({ kind: 'elevation' })}>
        <Frame className="h-3.5 w-3.5 text-accent" />
        <span className="truncate font-medium">{e.name}</span>
        <span className="ml-auto font-mono text-2xs text-faint">
          {fmtDim(e.width)}×{fmtDim(e.height)}
        </span>
      </button>
      {e.bays.map((bay, b) => {
        const ys = [0, ...bay.transoms, e.height];
        const open = !collapsed[b];
        const allKeys = ys.slice(0, -1).map((_, f) => fillKey(b, f));
        return (
          <div key={b}>
            <div className="flex h-6 items-center pl-2 pr-2 hover:bg-hover">
              <button className="text-faint" onClick={() => setCollapsed({ ...collapsed, [b]: open })} aria-label={open ? 'Collapse bay' : 'Expand bay'}>
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              <button className="flex flex-1 items-center gap-1.5 pl-1 text-left" onClick={() => setSelection({ kind: 'fields', keys: allKeys })}>
                <Columns3 className="h-3 w-3 text-faint" />
                <span>Bay {b + 1}</span>
                <span className="ml-auto font-mono text-2xs text-faint">{fmtDim(e.mullions[b + 1] - e.mullions[b])}</span>
              </button>
            </div>
            {open &&
              ys
                .slice(0, -1)
                .map((_, f) => f)
                .reverse()
                .map((f) => {
                  const key = fillKey(b, f);
                  const fill = resolveFill(e, key);
                  return (
                    <button
                      key={key}
                      data-testid={`tree-${key}`}
                      className={clsx('flex h-6 w-full items-center gap-1.5 pl-9 pr-2 text-left hover:bg-hover', selKeys.includes(key) && 'bg-accent/10 text-fg')}
                      onClick={(ev) => toggleField(key, ev.shiftKey)}
                    >
                      <FillSwatch type={fill.type} />
                      <span className="text-muted">F{f + 1}</span>
                      <span className="truncate capitalize text-faint">{fill.type}</span>
                      <span className="ml-auto font-mono text-2xs text-faint">{fmtDim(ys[f + 1] - ys[f])}</span>
                    </button>
                  );
                })}
          </div>
        );
      })}
      <div className="mt-1 border-t border-line pt-1">
        <div className="section-title px-2 py-1">Mullions</div>
        {e.mullions.map((x, i) => (
          <button key={i} className={clsx('flex h-6 w-full items-center gap-1.5 px-3 text-left hover:bg-hover', selection.kind === 'mullion' && selection.index === i && 'bg-accent/10')} onClick={() => setSelection({ kind: 'mullion', index: i })}>
            <Square className="h-2.5 w-2.5 text-faint" />
            <span>M{i + 1}</span>
            <span className="text-faint">{i === 0 || i === e.mullions.length - 1 ? 'edge' : ''}</span>
            <span className="ml-auto font-mono text-2xs text-faint">x {fmtDim(x)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
