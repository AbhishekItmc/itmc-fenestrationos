import clsx from 'clsx';
import { CALC_ENGINE_VERSION } from '../engine/calc';
import { CUTTING_ENGINE_VERSION } from '../engine/cutting1d';
import { fmtMm } from '../lib/format';
import { useApp } from '../store/app';
import { useStatus } from '../store/status';

function Cell({ label, children, className, tip }: { label?: string; children: React.ReactNode; className?: string; tip?: string }) {
  return (
    <div data-tip={tip} data-tip-pos="top" className={clsx('flex h-full items-center gap-1.5 border-r border-line px-2.5', className)}>
      {label && <span className="text-faint">{label}</span>}
      {children}
    </div>
  );
}

export function StatusBar() {
  const { cursor, selection, snap, validation } = useStatus();
  const { mode, catalogue, catalogueSource } = useApp();
  return (
    <footer className="flex h-6 shrink-0 items-center border-t border-line bg-panel font-mono text-2xs text-muted" data-testid="status-bar">
      <Cell label="units">mm</Cell>
      <Cell label="snap">{snap}</Cell>
      <Cell label="x" className="w-[86px]">
        {cursor ? fmtMm(cursor.x) : '—'}
      </Cell>
      <Cell label="y" className="w-[86px]">
        {cursor ? fmtMm(cursor.y) : '—'}
      </Cell>
      <Cell label="sel" className="min-w-0 max-w-[280px] truncate">
        <span className="truncate">{selection}</span>
      </Cell>
      <div className="flex-1" />
      <Cell label="engine" tip={mode === 'server' ? 'Server engines (authoritative)' : 'Offline TS port of the engines'}>
        {mode === 'server' ? 'server' : `${CALC_ENGINE_VERSION.split('+')[0]} · ${CUTTING_ENGINE_VERSION.split('+')[0]} (ts)`}
      </Cell>
      <Cell label="catalogue" tip={catalogueSource === 'server' ? 'Loaded from server' : 'Bundled DEMO catalogue'}>
        {catalogue.catalogue_version}
        <span className="text-prov">DEMO</span>
      </Cell>
      <Cell label="validation" className="border-r-0">
        {validation === null ? (
          <span className="text-faint">—</span>
        ) : validation.errors ? (
          <span className="text-err">{validation.errors} error(s)</span>
        ) : validation.warnings ? (
          <span className="text-warn">{validation.warnings} warning(s)</span>
        ) : (
          <span className="text-ok">OK</span>
        )}
      </Cell>
    </footer>
  );
}
