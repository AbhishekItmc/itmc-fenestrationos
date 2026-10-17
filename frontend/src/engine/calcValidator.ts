/**
 * INDEPENDENT calc result validator (port of validators.validate_calc). Imports nothing from calc.ts:
 * re-derives member counts, field fills and BOM sums from the echoed elevation.
 */
import type { CalcResult, Issue, ValidationReport } from '../api/types';

export const VALIDATOR_CALC = 'validate_calc/1.0+ts';
const EPS = 1e-6;
const AREA_TOL_M2 = 1e-6;

export function validateCalc(result: CalcResult): ValidationReport {
  const errors: Issue[] = [];
  let checked = 0;
  const err = (code: string, message: string, ref: string | null = null) => {
    if (errors.length < 500) errors.push({ code, severity: 'error', message, ref });
  };
  const report = (): ValidationReport => ({ passed: errors.length === 0, validator: VALIDATOR_CALC, errors, checked_items: checked });
  const e = result.elevation;
  const qty = e.quantity;
  const hasErrors = result.issues.some((i) => i.severity === 'error');
  if (result.validation_status === 'INVALID' || hasErrors) {
    if (result.profile_cuts.length || result.glass_items.length) err('INVALID_WITH_OUTPUT', 'result with error issues must not contain cuts or glass', 'result');
    return report();
  }
  const byRole: Record<string, number> = {};
  const profLen: Record<string, number> = {};
  for (const pc of result.profile_cuts) {
    checked++;
    const ref = `cut:${pc.mark}`;
    if (!(pc.length > 0)) err('NONPOSITIVE_LENGTH', `cut ${pc.mark} length ${pc.length}`, ref);
    if (pc.quantity < 1) err('BAD_QUANTITY', `cut ${pc.mark} quantity ${pc.quantity}`, ref);
    if (pc.quantity % qty) err('QTY_NOT_MULTIPLE', `cut ${pc.mark} quantity not a multiple of elevation quantity`, ref);
    byRole[pc.role] = (byRole[pc.role] ?? 0) + pc.quantity;
    profLen[pc.profile_id] = (profLen[pc.profile_id] ?? 0) + pc.length * pc.quantity;
  }
  const nM = e.mullions.length;
  const nB = e.bays.length;
  const nT = e.bays.reduce((s, b) => s + b.transoms.length, 0);
  for (const [role, exp] of [
    ['mullion', nM * qty],
    ['sill', nB * qty],
    ['head', nB * qty],
    ['transom', nT * qty],
  ] as const) {
    if ((byRole[role] ?? 0) !== exp) err('MEMBER_COUNT_MISMATCH', `${role}: ${byRole[role] ?? 0} cut pieces, expected ${exp}`, role);
  }
  const fields: Record<string, [number, number]> = {};
  for (let b = 0; b < nB; b++) {
    const ys = [0, ...e.bays[b].transoms, e.height];
    for (let f = 0; f < ys.length - 1; f++) fields[`b${b}-f${f}`] = [e.mullions[b + 1] - e.mullions[b], ys[f + 1] - ys[f]];
  }
  const seen: Record<string, number> = {};
  const glassArea: Record<string, number> = {};
  const panelArea: Record<string, number> = {};
  for (const g of result.glass_items) {
    checked++;
    const ref = `glass:${g.mark}`;
    if (!(g.width > 0 && g.height > 0)) err('NONPOSITIVE_GLASS', `glass ${g.mark} size ${g.width}x${g.height}`, ref);
    if (Math.abs(g.area_m2 - (g.width * g.height) / 1e6) > AREA_TOL_M2) err('AREA_MISMATCH', `glass ${g.mark} area ${g.area_m2} != w*h`, ref);
    if (g.quantity !== qty) err('BAD_QUANTITY', `glass ${g.mark} quantity ${g.quantity} != elevation quantity ${qty}`, ref);
    const fld = fields[g.field_key];
    if (!fld) err('UNKNOWN_FIELD', `glass ${g.mark} refers to unknown field ${g.field_key}`, ref);
    else if (g.width > fld[0] + EPS || g.height > fld[1] + EPS) err('GLASS_LARGER_THAN_FIELD', `glass ${g.mark} larger than field axis size`, ref);
    seen[g.field_key] = (seen[g.field_key] ?? 0) + 1;
    if (g.fill_type === 'panel') {
      const k = g.panel_type_id || 'unspecified';
      panelArea[k] = (panelArea[k] ?? 0) + g.area_m2 * g.quantity;
    } else {
      const k = g.glass_type_id || 'unspecified';
      glassArea[k] = (glassArea[k] ?? 0) + g.area_m2 * g.quantity;
    }
  }
  for (const key of Object.keys(fields)) {
    const ftype = e.fills[key]?.type ?? 'glass';
    const want = ftype === 'glass' || ftype === 'spandrel' || ftype === 'panel' ? 1 : 0;
    if ((seen[key] ?? 0) !== want) err('FIELD_FILL_COUNT', `field ${key} (${ftype}) has ${seen[key] ?? 0} fill items, expected ${want}`, `field:${key}`);
  }
  const bomProf: Record<string, number> = {};
  const bomGlass: Record<string, number> = {};
  const bomPanel: Record<string, number> = {};
  for (const line of result.bom) {
    checked++;
    if (line.quantity < 0) err('NEGATIVE_BOM', `BOM ${line.code} negative quantity`, `bom:${line.item_id}`);
    if (line.item_type === 'profile' && line.unit === 'm') bomProf[line.item_id] = (bomProf[line.item_id] ?? 0) + line.quantity;
    else if (line.item_type === 'glass' && line.unit === 'm2') bomGlass[line.item_id] = (bomGlass[line.item_id] ?? 0) + line.quantity;
    else if (line.item_type === 'panel' && line.unit === 'm2') bomPanel[line.item_id] = (bomPanel[line.item_id] ?? 0) + line.quantity;
  }
  for (const pid of new Set([...Object.keys(profLen), ...Object.keys(bomProf)])) {
    if (Math.abs((profLen[pid] ?? 0) / 1000 - (bomProf[pid] ?? 0)) > 1e-6)
      err('BOM_PROFILE_MISMATCH', `profile ${pid}: BOM ${bomProf[pid] ?? 0} m != cuts ${(profLen[pid] ?? 0) / 1000} m`, `bom:${pid}`);
  }
  for (const [src, bom, name] of [
    [glassArea, bomGlass, 'glass'],
    [panelArea, bomPanel, 'panel'],
  ] as const) {
    for (const gid of new Set([...Object.keys(src), ...Object.keys(bom)])) {
      if (Math.abs((src[gid] ?? 0) - (bom[gid] ?? 0)) > 1e-6) err('BOM_AREA_MISMATCH', `${name} ${gid}: BOM ${bom[gid] ?? 0} != items ${src[gid] ?? 0}`, `bom:${gid}`);
    }
  }
  const t = result.totals ?? {};
  const sumVals = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  if ('glass_area_m2' in t && Math.abs(t.glass_area_m2 - sumVals(glassArea)) > 1e-6) err('TOTALS_MISMATCH', 'totals.glass_area_m2 != sum of glass items', 'totals');
  if ('profile_length_m' in t && Math.abs(t.profile_length_m - sumVals(profLen) / 1000) > 1e-6) err('TOTALS_MISMATCH', 'totals.profile_length_m != sum of cuts', 'totals');
  if ('field_count' in t && Math.trunc(t.field_count) !== Object.keys(fields).length) err('TOTALS_MISMATCH', 'totals.field_count != number of fields', 'totals');
  return report();
}
