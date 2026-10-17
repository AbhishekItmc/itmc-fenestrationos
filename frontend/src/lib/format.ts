/** Number / dimension formatting. Engineering display: mm with up to 1 decimal, tabular mono in the UI. */

/** Format a millimetre length: integers without decimals, otherwise up to `maxDecimals` (trailing zeros trimmed). */
export function fmtMm(v: number | null | undefined, maxDecimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const r = Number(v.toFixed(maxDecimals));
  const s = Object.is(r, -0) ? 0 : r;
  return Number.isInteger(s) ? String(s) : s.toFixed(maxDecimals).replace(/0+$/, '').replace(/\.$/, '');
}

/** Dimension label as used on drawings, e.g. 1500 or 1234.5 */
export const fmtDim = (v: number) => fmtMm(v, 1);

/** Thousands-grouped number (en-IN style grouping avoided: use plain thin grouping for engineering). */
export function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(ratio: number | null | undefined, decimals = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(decimals)} %`;
}

export function fmtM(mm: number | null | undefined, decimals = 2): string {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return '—';
  return `${fmtNum(mm / 1000, decimals)} m`;
}

export function fmtArea(m2: number | null | undefined, decimals = 2): string {
  if (m2 === null || m2 === undefined || !Number.isFinite(m2)) return '—';
  return `${fmtNum(m2, decimals)} m²`;
}

export function fmtQty(v: number, unit: string): string {
  const d = unit === 'pcs' ? 0 : unit === 'm2' || unit === 'm' ? 2 : 1;
  const u = unit === 'm2' ? 'm²' : unit;
  return `${fmtNum(v, d)} ${u}`;
}

export function fmtMoney(v: number | null | undefined, currency = 'INR'): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${currency} ${fmtNum(v, 2)}`;
  }
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Parse a user-entered length ("1 234,5", "1234.5 mm", "1.2m") into mm; null when invalid. */
export function parseLength(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = /^(-?\d+(?:[.,]\d+)?)(mm|m|cm)?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  const unit = m[2] ?? 'mm';
  return unit === 'm' ? v * 1000 : unit === 'cm' ? v * 10 : v;
}
