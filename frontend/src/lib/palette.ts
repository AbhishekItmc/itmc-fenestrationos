/**
 * Categorical piece palette (dark-surface steps of the validated reference palette; slots 6 green and
 * 8 red are omitted because green/red are reserved for status: reusable offcut / waste).
 * Validated: node validate_palette.js "<these>" --mode dark → all checks pass (CVD worst 8.4).
 * Hues are assigned in fixed order by piece-type index and never cycled: types beyond the 6th share a
 * neutral steel fill and rely on their direct labels.
 */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
export const OVERFLOW = '#5b6676';
export const STATUS = { ok: '#34d399', bad: '#f87171' };

export function seriesColor(index: number): string {
  return index >= 0 && index < SERIES.length ? SERIES[index] : OVERFLOW;
}
