import type { EdgeTrim, SheetLayout } from '../../api/types';
import { fmtMm, fmtPct } from '../../lib/format';
import { seriesColor, STATUS } from '../../lib/palette';

/** One sheet layout drawn to scale (origin bottom-left, y up). */
/** `scale` (px per mm) should be shared by all layouts of a result so sheet sizes compare truthfully. */
export function SheetView({ lay, trim, colorOf, scale }: { lay: SheetLayout; trim: EdgeTrim; colorOf: (id: string) => number; scale: number }) {
  const pad = 4;
  const k = scale;
  const W = lay.width * k;
  const H = lay.height * k;
  const X = (x: number) => pad + x * k;
  const Y = (y: number) => pad + H - y * k;
  return (
    <svg width={W + pad * 2} height={H + pad * 2} className="block" data-testid="sheet-svg">
      <defs>
        <pattern id="sheet-trim" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#1e252e" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#6b7685" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={pad} y={pad} width={W} height={H} fill="url(#sheet-trim)" stroke="rgb(var(--line-strong))" />
      <rect x={X(trim.left)} y={Y(lay.height - trim.top)} width={Math.max(0, (lay.width - trim.left - trim.right) * k)} height={Math.max(0, (lay.height - trim.top - trim.bottom) * k)} fill="#0b0e12" />
      {lay.residuals.map((r, i) => (
        <g key={`r${i}`}>
          <rect x={X(r.x)} y={Y(r.y + r.height)} width={r.width * k} height={r.height * k} fill={r.reusable ? STATUS.ok : 'transparent'} fillOpacity={r.reusable ? 0.08 : 0} stroke={r.reusable ? STATUS.ok : '#6b7685'} strokeWidth={1} strokeDasharray="5 3">
            <title>{`${r.reusable ? 'Reusable residual' : 'Residual (below min size)'} ${fmtMm(r.width)} × ${fmtMm(r.height)}`}</title>
          </rect>
          {r.reusable && r.width * k > 90 && r.height * k > 22 && (
            <text x={X(r.x) + (r.width * k) / 2} y={Y(r.y + r.height / 2) + 4} fontSize={12} textAnchor="middle" fill="rgb(var(--muted))" pointerEvents="none">
              {`residual ${fmtMm(r.width)}×${fmtMm(r.height)}`}
            </text>
          )}
        </g>
      ))}
      {lay.placements.map((p, i) => {
        const col = seriesColor(colorOf(p.piece_id));
        const w = p.width * k;
        const h = p.height * k;
        const x = X(p.x);
        const y = Y(p.y + p.height);
        const dims = `${fmtMm(p.width)}×${fmtMm(p.height)}`;
        return (
          <g key={`p${i}`}>
            <rect x={x} y={y} width={w} height={h} fill={col} fillOpacity={0.42} stroke={col} strokeWidth={1}>
              <title>{`${p.piece_id}${p.label ? ` · ${p.label}` : ''}\n${dims} mm${p.rotated ? ' · rotated 90°' : ''}\nat (${fmtMm(p.x)}, ${fmtMm(p.y)})`}</title>
            </rect>
            {w > 34 && h > 16 && (
              <text x={x + w / 2} y={y + h / 2 + (h > 34 ? -2 : 4)} fontSize={13} textAnchor="middle" fill="rgb(var(--fg))" fontWeight={600} pointerEvents="none">
                {p.piece_id}
                {p.rotated ? ' ↻' : ''}
              </text>
            )}
            {w > dims.length * 6 + 6 && h > 34 && (
              <text x={x + w / 2} y={y + h / 2 + 11} fontSize={11.5} textAnchor="middle" fill="rgb(var(--muted))" pointerEvents="none">
                {dims}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function layoutCaption(lay: SheetLayout): string {
  return `${lay.sheet_label ?? lay.sheet_id} · ${fmtMm(lay.width)}×${fmtMm(lay.height)} · ${lay.placements.length} pcs · ${fmtPct(lay.utilization)}`;
}
