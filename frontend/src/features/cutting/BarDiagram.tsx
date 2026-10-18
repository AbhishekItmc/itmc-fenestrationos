import type { Pattern1D } from '../../api/types';
import { fmtMm } from '../../lib/format';
import { seriesColor, SERIES_FILL_OPACITY, STATUS } from '../../lib/palette';

/** One stock bar drawn to scale: trims hatched, pieces coloured by type, kerf slivers, offcut/waste. */
export function BarDiagram({ p, kerf, trimStart, trimEnd, colorOf, width = 900 }: { p: Pattern1D; kerf: number; trimStart: number; trimEnd: number; colorOf: (pieceId: string) => number; width?: number }) {
  const H = 30;
  const k = width / p.stock_length;
  const segs: JSX.Element[] = [];
  segs.push(
    <rect key="ts" x={0} y={0} width={Math.max(0, trimStart * k)} height={H} fill="url(#bar-trim)">
      <title>{`Trim start ${fmtMm(trimStart)} mm`}</title>
    </rect>,
  );
  p.cuts.forEach((c, i) => {
    const x = c.offset * k;
    const w = c.length * k;
    const col = seriesColor(colorOf(c.piece_id));
    const label = `${c.piece_id} ${fmtMm(c.length)}`;
    segs.push(
      <g key={`c${i}`}>
        <rect x={x} y={0} width={Math.max(1, w)} height={H} fill={col} style={{ fillOpacity: SERIES_FILL_OPACITY }} stroke={col} strokeWidth={1}>
          <title>{`${c.piece_id}${c.label ? ` · ${c.label}` : ''}\nlength ${fmtMm(c.length)} mm · offset ${fmtMm(c.offset)} mm · ${c.angle_start}°/${c.angle_end}°`}</title>
        </rect>
        {w > label.length * 6.4 + 6 ? (
          <text x={x + w / 2} y={H / 2 + 4} fontSize={13} textAnchor="middle" fill="rgb(var(--fg))" pointerEvents="none">
            {label}
          </text>
        ) : w > c.piece_id.length * 6.4 + 4 ? (
          <text x={x + w / 2} y={H / 2 + 4} fontSize={12.5} textAnchor="middle" fill="rgb(var(--fg))" pointerEvents="none">
            {c.piece_id}
          </text>
        ) : null}
        {kerf > 0 && <rect x={x + w} y={0} width={Math.max(1, kerf * k)} height={H} fill="var(--dia-kerf)" />}
      </g>,
    );
  });
  const remX = p.used_length * k;
  const remW = Math.max(0, p.remainder * k);
  if (p.remainder > 0.05) {
    const col = p.offcut_reusable ? STATUS.ok : STATUS.bad;
    segs.push(
      <g key="rem">
        <rect x={remX} y={0} width={remW} height={H} fill={col} fillOpacity={0.14} stroke={col} strokeWidth={1} strokeDasharray={p.offcut_reusable ? undefined : '4 3'}>
          <title>{`${p.offcut_reusable ? 'Reusable offcut' : 'Waste'} ${fmtMm(p.remainder)} mm`}</title>
        </rect>
        {remW > 70 && (
          <text x={remX + remW / 2} y={H / 2 + 4} fontSize={12.5} textAnchor="middle" fill="rgb(var(--muted))" pointerEvents="none">
            {`${p.offcut_reusable ? 'offcut' : 'waste'} ${fmtMm(p.remainder)}`}
          </text>
        )}
      </g>,
    );
  }
  if (trimEnd > 0)
    segs.push(
      <rect key="te" x={width - trimEnd * k} y={0} width={trimEnd * k} height={H} fill="url(#bar-trim)">
        <title>{`Trim end ${fmtMm(trimEnd)} mm`}</title>
      </rect>,
    );
  return (
    <svg width={width} height={H + 1} className="block overflow-visible">
      <defs>
        <pattern id="bar-trim" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="var(--dia-hatch-bg)" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--dia-hatch-line)" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect x={0.5} y={0.5} width={width - 1} height={H} fill="var(--dia-bg)" stroke="rgb(var(--line-strong))" />
      {segs}
    </svg>
  );
}
