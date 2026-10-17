/** Unit + tolerance helpers (port of backend/app/engines/units.py). All lengths are mm. */
export const EPS = 1e-6;

/** Python round(value, ndigits) equivalent for practical purposes (half-away-from-zero on decimal repr). */
export function roundTo(value: number, ndigits = 3): number {
  const f = 10 ** ndigits;
  const r = Math.round(Math.abs(value) * f) / f;
  return (value < 0 ? -r : r) + 0;
}

/** Python f"{v:g}" (6 significant digits, trailing zeros stripped, exponent outside 1e-4..1e6). */
export function fmtG(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const exp = Number(v.toExponential(5).split('e')[1]);
  if (exp < -4 || exp >= 6) {
    const [m, e] = v.toExponential(5).split('e');
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    const en = Number(e);
    return `${mant}e${en < 0 ? '-' : '+'}${String(Math.abs(en)).padStart(2, '0')}`;
  }
  const s = v.toFixed(Math.max(0, 5 - exp));
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function mmToM(mm: number): number {
  return mm / 1000;
}

export function feq(a: number, b: number, tol = EPS): boolean {
  return Math.abs(a - b) <= tol;
}
