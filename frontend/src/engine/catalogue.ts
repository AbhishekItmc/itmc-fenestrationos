/** Catalogue lookups (port of backend/app/engines/catalogue.py). DEMO DATA ONLY. */
import type {
  CatAccessory,
  CatColour,
  CatCompatibility,
  CatGlassType,
  CatPanelType,
  CatProfile,
  CatRuleSet,
  CatSeries,
  Catalogue,
} from '../api/types';
import raw from './demoCatalogue.json';

export const DEMO_CATALOGUE: Catalogue = raw as unknown as Catalogue;

export const REQUIRED_RULE_PARAMS = [
  'mullion_ext_top',
  'mullion_ext_bottom',
  'transom_clearance',
  'glass_deduction_x',
  'glass_deduction_y',
  'gasket_runs_per_field_edge',
  'connectors_per_transom',
  'brackets_per_anchor',
  'max_bar_length',
  'min_field_width',
  'min_field_height',
  'max_field_width',
  'max_field_height',
] as const;

function find<T extends { id: string }>(items: T[] | undefined, id: string | null | undefined): T | null {
  if (!id) return null;
  for (const it of items ?? []) if (it.id === id) return it;
  return null;
}

export const getSeries = (c: Catalogue, id?: string | null): CatSeries | null => find(c.series, id);
export const getProfile = (c: Catalogue, id?: string | null): CatProfile | null => find(c.profiles, id);
export const getRuleSet = (c: Catalogue, id?: string | null): CatRuleSet | null => find(c.rule_sets, id);
export const getGlassType = (c: Catalogue, id?: string | null): CatGlassType | null => find(c.glass_types, id);
export const getPanelType = (c: Catalogue, id?: string | null): CatPanelType | null => find(c.panel_types, id);
export const getColour = (c: Catalogue, id?: string | null): CatColour | null => find(c.colours, id);
export const getAccessory = (c: Catalogue, id?: string | null): CatAccessory | null => find(c.accessories, id);

/** First accessory of `kind` applicable to the series (series-specific preferred over shared). */
export function findAccessory(c: Catalogue, kind: string, seriesId: string | null | undefined): CatAccessory | null {
  let shared: CatAccessory | null = null;
  for (const a of c.accessories ?? []) {
    if (a.kind !== kind) continue;
    const sids = a.series_ids ?? [];
    if (seriesId && sids.length === 1 && sids[0] === seriesId) return a;
    if ((sids.length === 0 || (seriesId != null && sids.includes(seriesId))) && shared === null) shared = a;
  }
  return shared;
}

export function compatibilityRules(c: Catalogue, seriesId: string | null | undefined, kind: string): CatCompatibility[] {
  return (c.compatibility ?? []).filter(
    (r) => r.kind === kind && (r.series_id === null || r.series_id === undefined || r.series_id === seriesId),
  );
}

/** Glass types usable in a series (thickness inside the series glazing range; `project` always listed). */
export function glassTypesForSeries(c: Catalogue, seriesId: string | null | undefined): CatGlassType[] {
  const s = getSeries(c, seriesId);
  if (!s) return c.glass_types;
  const ranges: [number, number][] = [];
  if (s.glass_thickness_min != null && s.glass_thickness_max != null) ranges.push([s.glass_thickness_min, s.glass_thickness_max]);
  for (const r of compatibilityRules(c, s.id, 'glass_thickness_range')) ranges.push([r.params.min ?? 0, r.params.max ?? 1e9]);
  return c.glass_types.filter((g) => g.thickness == null || ranges.every(([lo, hi]) => g.thickness! >= lo - 1e-6 && g.thickness! <= hi + 1e-6));
}
