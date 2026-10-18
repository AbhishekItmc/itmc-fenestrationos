/**
 * Drawing dimension primitives (screen-space SVG). Engineering style: extension lines with gap and
 * overshoot, dimension line, 45° oblique ticks, mono label with background knock-out.
 */
import { fmtDim } from '../../lib/format';

const TICK = 4.5;
const GAP = 3;
const OVER = 5;
const CHAR_W = 6.6;

export interface DimStyle {
  color?: string;
  textColor?: string;
  emphasis?: boolean;
}

/** Horizontal dimension between screen x0..x1 at screen y; extension lines start at refY (feature edge). */
export function DimH({ x0, x1, y, refY, value, label, style, testId }: { x0: number; x1: number; y: number; refY: number; value: number; label?: string; style?: DimStyle; testId?: string }) {
  const color = style?.color ?? 'var(--cad-dim)';
  const tc = style?.textColor ?? 'var(--cad-dim-text)';
  const dir = y > refY ? 1 : -1;
  const text = label ?? fmtDim(value);
  const w = Math.abs(x1 - x0);
  const tw = text.length * CHAR_W + 6;
  const fits = w > tw + 4;
  const tx = (x0 + x1) / 2;
  const ty = fits ? y - 4 : y - 4 - (dir < 0 ? 0 : 0);
  const sw = style?.emphasis ? 1.25 : 0.9;
  return (
    <g data-testid={testId} className="dim">
      <line x1={x0} y1={refY + dir * GAP} x2={x0} y2={y + dir * OVER} stroke={color} strokeWidth={0.7} />
      <line x1={x1} y1={refY + dir * GAP} x2={x1} y2={y + dir * OVER} stroke={color} strokeWidth={0.7} />
      <line x1={x0 - 6} y1={y} x2={x1 + 6} y2={y} stroke={color} strokeWidth={sw} />
      <line x1={x0 - TICK} y1={y + TICK} x2={x0 + TICK} y2={y - TICK} stroke={color} strokeWidth={1.5} />
      <line x1={x1 - TICK} y1={y + TICK} x2={x1 + TICK} y2={y - TICK} stroke={color} strokeWidth={1.5} />
      {w > 14 && (
        <>
          <rect x={tx - tw / 2} y={ty - 10} width={tw} height={12} fill="var(--cad-text-bg)" opacity={fits ? 0.9 : 0.95} rx={1} />
          <text x={tx} y={ty} fontSize={style?.emphasis ? 11.5 : 10.5} fill={tc} textAnchor="middle" fontWeight={style?.emphasis ? 600 : 400}>
            {text}
          </text>
        </>
      )}
    </g>
  );
}

/** Vertical dimension between screen y0..y1 at screen x; extension lines start at refX. Label rotated. */
export function DimV({ y0, y1, x, refX, value, label, style, testId }: { y0: number; y1: number; x: number; refX: number; value: number; label?: string; style?: DimStyle; testId?: string }) {
  const color = style?.color ?? 'var(--cad-dim)';
  const tc = style?.textColor ?? 'var(--cad-dim-text)';
  const dir = x > refX ? 1 : -1;
  const text = label ?? fmtDim(value);
  const h = Math.abs(y1 - y0);
  const tw = text.length * CHAR_W + 6;
  const ty = (y0 + y1) / 2;
  const tx = x - 4;
  const sw = style?.emphasis ? 1.25 : 0.9;
  return (
    <g data-testid={testId} className="dim">
      <line x1={refX + dir * GAP} y1={y0} x2={x + dir * OVER} y2={y0} stroke={color} strokeWidth={0.7} />
      <line x1={refX + dir * GAP} y1={y1} x2={x + dir * OVER} y2={y1} stroke={color} strokeWidth={0.7} />
      <line x1={x} y1={Math.min(y0, y1) - 6} x2={x} y2={Math.max(y0, y1) + 6} stroke={color} strokeWidth={sw} />
      <line x1={x - TICK} y1={y0 + TICK} x2={x + TICK} y2={y0 - TICK} stroke={color} strokeWidth={1.5} />
      <line x1={x - TICK} y1={y1 + TICK} x2={x + TICK} y2={y1 - TICK} stroke={color} strokeWidth={1.5} />
      {h > 14 && (
        <g transform={`rotate(-90 ${tx} ${ty})`}>
          <rect x={tx - tw / 2} y={ty - 10} width={tw} height={12} fill="var(--cad-text-bg)" opacity={0.9} rx={1} />
          <text x={tx} y={ty} fontSize={style?.emphasis ? 11.5 : 10.5} fill={tc} textAnchor="middle" fontWeight={style?.emphasis ? 600 : 400}>
            {text}
          </text>
        </g>
      )}
    </g>
  );
}

/** Small floating label (live drag feedback). */
export function Tag({ x, y, text, tone = 'accent', anchor = 'middle' }: { x: number; y: number; text: string; tone?: 'accent' | 'warn' | 'err'; anchor?: 'start' | 'middle' | 'end' }) {
  const w = text.length * 6.7 + 10;
  const fill = tone === 'accent' ? 'var(--cad-select)' : tone === 'warn' ? 'var(--cad-warn)' : 'var(--cad-error)';
  const rx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return (
    <g pointerEvents="none">
      <rect x={rx} y={y - 12} width={w} height={17} rx={2} fill={fill} />
      <text x={rx + w / 2} y={y} fontSize={13} fill="var(--cad-text-bg)" textAnchor="middle" fontWeight={600}>
        {text}
      </text>
    </g>
  );
}
