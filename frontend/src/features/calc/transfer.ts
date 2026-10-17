/** Build optimiser drafts from a calculation result (calc → 1D cutting / 2D nesting). */
import type { CalcResult, Catalogue } from '../../api/types';
import { getGlassType, getPanelType, getProfile } from '../../engine/catalogue';
import { emptyCuttingDraft, type CuttingDraft } from '../cutting/store';
import { emptyNestingDraft, type NestingDraft } from '../nesting/store';

export function profilesInResult(r: CalcResult): { id: string; code: string; pieces: number }[] {
  const m = new Map<string, { id: string; code: string; pieces: number }>();
  for (const c of r.profile_cuts) {
    const cur = m.get(c.profile_id) ?? { id: c.profile_id, code: c.profile_code, pieces: 0 };
    cur.pieces += c.quantity;
    m.set(c.profile_id, cur);
  }
  return [...m.values()];
}

export function cuttingDraftFromCalc(r: CalcResult, profileId: string, cat: Catalogue, elevationName: string): CuttingDraft {
  const p = getProfile(cat, profileId);
  const lengths = p?.stock_lengths?.length ? p.stock_lengths : [6000];
  const code = p?.code ?? profileId;
  return {
    ...emptyCuttingDraft(),
    name: `${elevationName} — ${code}`,
    material: code,
    stocks: lengths.map((L) => ({ id: `S${L}`, label: `Stock bar ${L} (catalogue, demo)`, length: L, quantity: null, unlimited: true, is_offcut: false })),
    pieces: r.profile_cuts
      .filter((c) => c.profile_id === profileId)
      .map((c) => ({ id: c.mark, label: `${c.description}${c.position ? ` · ${c.position.slice(0, 60)}` : ''}`, length: c.length, quantity: c.quantity, angle_start: c.angle_start, angle_end: c.angle_end })),
    source: `calc ${r.inputs_hash.slice(0, 8)} · ${elevationName}`,
  };
}

export function fillGroupsInResult(r: CalcResult, cat: Catalogue): { key: string; label: string; thickness: number | null; count: number }[] {
  const m = new Map<string, { key: string; label: string; thickness: number | null; count: number }>();
  for (const g of r.glass_items) {
    const key = g.fill_type === 'panel' ? `panel:${g.panel_type_id}` : `glass:${g.glass_type_id ?? 'unspecified'}`;
    const label = g.fill_type === 'panel' ? (getPanelType(cat, g.panel_type_id)?.code ?? 'panel') : (getGlassType(cat, g.glass_type_id)?.code ?? 'glass (unspecified)');
    const thickness = g.fill_type === 'panel' ? (getPanelType(cat, g.panel_type_id)?.thickness ?? null) : (getGlassType(cat, g.glass_type_id)?.thickness ?? null);
    const cur = m.get(key) ?? { key, label, thickness, count: 0 };
    cur.count += g.quantity;
    m.set(key, cur);
  }
  return [...m.values()];
}

export function nestingDraftFromCalc(r: CalcResult, groupKey: string, cat: Catalogue, elevationName: string): NestingDraft {
  const groups = fillGroupsInResult(r, cat);
  const g = groups.find((x) => x.key === groupKey);
  const isPanel = groupKey.startsWith('panel:');
  const base = emptyNestingDraft();
  const items = r.glass_items.filter((gi) => (isPanel ? `panel:${gi.panel_type_id}` : `glass:${gi.glass_type_id ?? 'unspecified'}`) === groupKey);
  return {
    ...base,
    name: `${elevationName} — ${g?.label ?? groupKey}`,
    guillotine: !isPanel,
    sheets: isPanel
      ? [{ id: 'SHEET', label: 'Panel sheet 3050×1250 (demo size)', width: 3050, height: 1250, quantity: null, unlimited: true, is_residual: false }]
      : base.sheets,
    pieces: items.map((gi) => ({ id: gi.mark, label: `${gi.description.slice(0, 40)} · ${gi.field_key}`, width: gi.width, height: gi.height, quantity: gi.quantity, can_rotate: true })),
    source: `calc ${r.inputs_hash.slice(0, 8)} · ${elevationName}`,
  };
}
