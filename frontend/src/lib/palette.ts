/**
 * Categorical piece palette as CSS variables (index.css): dark-surface steps of the validated reference
 * palette in the dark theme, light tints (dark labels on top) in the light theme. Slots for green and red are
 * omitted because green/red are reserved for status: reusable offcut / waste.
 * Hues are assigned in fixed order by piece-type index and never cycled: types beyond the 6th share a
 * neutral steel fill and rely on their direct labels.
 */
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
export const OVERFLOW = 'var(--s-overflow)';
export const STATUS = { ok: 'var(--dia-ok)', bad: 'var(--dia-bad)' };
export const SERIES_FILL_OPACITY = 'var(--series-fill-opacity)';

export function seriesColor(index: number): string {
  return index >= 0 && index < SERIES.length ? SERIES[index] : OVERFLOW;
}
