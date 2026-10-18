/**
 * Elevation calculation: cut list, glass/fill sizes and BOM.
 * Faithful TypeScript port of backend/app/engines/calc.py — ALL RULES ARE PROVISIONAL DEMO RULES.
 * Offline demo engine: server results are authoritative.
 */
import type { BomLine, Catalogue, CalcResult, CatProfile, Elevation, GlassItem, Issue, ProfileCut, ProfileCutRole } from '../api/types';
import { findAccessory, getGlassType, getPanelType, getProfile, getSeries } from './catalogue';
import { validateCalc } from './calcValidator';
import { runDesignChecks } from './checks';
import {
  effectiveMullionProfileId,
  effectiveTransomProfileId,
  fieldRects,
  resolveFill,
  resolveRuleSet,
  validateElevation,
} from './elevation';
import { sha256Hex, stableStringify } from './hash';
import { EPS, fmtG as _fmt, roundTo } from './units';

export const CALC_ENGINE_VERSION = 'calc/0.1.0-demo+ts-offline';

interface Group {
  role: ProfileCutRole;
  prof: CatProfile;
  length: number;
  n: number;
  positions: string[];
  formula: string;
  rule_ids: string[];
  desc: string;
}

export function calculate(elev: Elevation, cat: Catalogue, ruleSetId: string | null = null): CalcResult {
  const catVersion = String(cat.catalogue_version ?? 'UNKNOWN');
  const issues: Issue[] = [...validateElevation(elev, cat, ruleSetId)];
  // DEMO design checks (§8.3): warnings only, appended when the geometry is valid
  if (!issues.some((i) => i.severity === 'error')) issues.push(...runDesignChecks(elev, cat, ruleSetId));
  const rs = resolveRuleSet(elev, cat, ruleSetId);
  if (rs === null && !issues.some((i) => ['RULE_SET_NOT_FOUND', 'SYSTEM_NOT_SET', 'SYSTEM_NOT_FOUND'].includes(i.code)))
    issues.push({ code: 'RULE_SET_NOT_FOUND', severity: 'error', message: 'No rule set available for this elevation', ref: 'rule_set' });
  if (rs !== null) {
    const missing = ['mullion_ext_top', 'mullion_ext_bottom', 'transom_clearance', 'glass_deduction_x', 'glass_deduction_y', 'gasket_runs_per_field_edge', 'connectors_per_transom', 'brackets_per_anchor', 'max_bar_length'].filter(
      (p) => !(p in (rs.params ?? {})),
    );
    if (missing.length) issues.push({ code: 'RULE_PARAM_MISSING', severity: 'error', message: `Rule set '${rs.id}' lacks params: ${missing.join(', ')}`, ref: 'rule_set' });
  }
  const rsId = rs?.id || ruleSetId || 'UNKNOWN';
  const rsVer = String(rs?.version ?? 'UNKNOWN');
  const approved = Boolean(rs?.approved);
  const inputsHash = sha256Hex(stableStringify({ elevation: elev, rule_set_id: rsId, catalogue_version: catVersion }));

  const result = (cuts: ProfileCut[], glass: GlassItem[], bom: BomLine[], totals: Record<string, number>, status: CalcResult['validation_status']): CalcResult => {
    const r: CalcResult = {
      units: 'mm',
      engine_version: CALC_ENGINE_VERSION,
      catalogue_version: catVersion,
      rule_set_id: rsId,
      rule_set_version: rsVer,
      rule_set_approved: approved,
      inputs_hash: inputsHash,
      elevation: elev,
      profile_cuts: cuts,
      glass_items: glass,
      bom,
      issues,
      validation_status: status,
      validation: { passed: true, validator: 'pending', errors: [], checked_items: 0 },
      totals,
    };
    r.validation = validateCalc(r);
    if (!r.validation.passed) r.validation_status = 'INVALID';
    return r;
  };

  if (issues.some((i) => i.severity === 'error') || rs === null) return result([], [], [], {}, 'INVALID');

  const P = rs.params;
  const RS = rs.id;
  const series = getSeries(cat, elev.system_id);
  const q = elev.quantity;
  const W = elev.width;
  const H = elev.height;
  const m = elev.mullions;
  const nM = m.length;
  const mull = getProfile(cat, effectiveMullionProfileId(elev, cat))!;
  const mfw = Number(mull.face_width);

  const groups = new Map<string, Group>();
  const addCut = (role: ProfileCutRole, prof: CatProfile, lengthIn: number, n: number, position: string, formula: string, ruleIds: string[], desc: string) => {
    const length = roundTo(lengthIn, 6);
    const key = `${role}|${prof.id}|${length}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { role, prof, length, n, positions: [position], formula, rule_ids: ruleIds, desc });
    else {
      g.n += n;
      g.positions.push(position);
    }
  };

  // --- mullions ---
  const ml = H + P.mullion_ext_top + P.mullion_ext_bottom;
  for (const x of m) {
    addCut(
      'mullion',
      mull,
      ml,
      1,
      `x=${_fmt(x)}`,
      `H + mullion_ext_top + mullion_ext_bottom = ${_fmt(H)} + ${_fmt(P.mullion_ext_top)} + ${_fmt(P.mullion_ext_bottom)} = ${_fmt(ml)}`,
      [`${RS}:mullion_ext_top`, `${RS}:mullion_ext_bottom`],
      `Mullion ${mull.code}`,
    );
  }

  // --- horizontals ---
  let nHorizontal = 0;
  const hRuns: [CatProfile, number, string][] = [];
  elev.bays.forEach((bay, b) => {
    const tp = getProfile(cat, effectiveTransomProfileId(elev, b, cat))!;
    const aw = m[b + 1] - m[b];
    const cl = P.transom_clearance;
    const tl = aw - mfw / 2 - mfw / 2 - 2 * cl;
    const formula = `bay axis width - mullion face/2 (left) - mullion face/2 (right) - 2 x transom_clearance = ${_fmt(aw)} - ${_fmt(mfw / 2)} - ${_fmt(mfw / 2)} - 2 x ${_fmt(cl)} = ${_fmt(tl)}`;
    const rids = [`${RS}:transom_clearance`, `profile:${mull.id}:face_width`];
    const levels: [number, 'sill' | 'transom' | 'head'][] = [[0, 'sill'], ...bay.transoms.map((y) => [y, 'transom'] as [number, 'transom']), [H, 'head']];
    for (const [y, role] of levels) {
      addCut(role, tp, tl, 1, `bay ${b + 1}, y=${_fmt(y)}`, formula, rids, `${role[0].toUpperCase()}${role.slice(1)} ${tp.code}`);
      hRuns.push([tp, aw, `bay ${b + 1}, y=${_fmt(y)}`]);
      nHorizontal += 1;
    }
  });

  // --- pressure plates / cover caps (DEMO rule: length == axis run) ---
  for (const [role, key] of [
    ['pressure_plate', 'pressure_plate_profile_id'],
    ['cover_cap', 'cover_cap_profile_id'],
  ] as const) {
    const pid = series?.[key];
    const prof = pid ? getProfile(cat, pid) : null;
    if (!prof) continue;
    const label = role === 'pressure_plate' ? 'Pressure plate' : 'Cover cap';
    for (const x of m)
      addCut(role, prof, H, 1, `vertical x=${_fmt(x)}`, `DEMO rule: vertical ${role} length = mullion axis run H = ${_fmt(H)}`, [`demo:${role}_axis_run`], `${label} (vertical) ${prof.code}`);
    for (const [, aw, pos] of hRuns)
      addCut(role, prof, aw, 1, `horizontal ${pos}`, `DEMO rule: horizontal ${role} length = bay axis width = ${_fmt(aw)}`, [`demo:${role}_axis_run`], `${label} (horizontal) ${prof.code}`);
  }

  const prefix: Record<ProfileCutRole, string> = { mullion: 'M', transom: 'T', sill: 'S', head: 'H', pressure_plate: 'PP', cover_cap: 'CC' };
  const counters: Record<string, number> = {};
  const cuts: ProfileCut[] = [];
  for (const g of groups.values()) {
    counters[g.role] = (counters[g.role] ?? 0) + 1;
    const pos = g.positions.slice(0, 12).join(', ') + (g.positions.length > 12 ? ' ...' : '');
    cuts.push({
      mark: `${prefix[g.role]}${counters[g.role]}`,
      role: g.role,
      profile_id: g.prof.id,
      profile_code: g.prof.code,
      description: g.desc,
      length: g.length,
      angle_start: 90,
      angle_end: 90,
      quantity: g.n * q,
      position: pos,
      formula: g.formula,
      rule_ids: g.rule_ids,
    });
    if (g.length > P.max_bar_length + EPS)
      issues.push({
        code: 'SPLICE_REQUIRED',
        severity: 'warning',
        message: `${g.desc} cut length ${_fmt(g.length)} mm exceeds max_bar_length ${_fmt(P.max_bar_length)} mm: a splice is required (splice positions are NOT computed - engineering input required)`,
        ref: `cut:${cuts[cuts.length - 1].mark}`,
      });
  }

  // --- glass / fills ---
  const gdx = P.glass_deduction_x;
  const gdy = P.glass_deduction_y;
  const glass: GlassItem[] = [];
  let fillPerimeterMm = 0;
  let paneCount = 0;
  for (const r of fieldRects(elev)) {
    const f = resolveFill(elev, r.key);
    if (f.type === 'none' || f.type === 'opening') continue;
    const aw = r.x1 - r.x0;
    const ah = r.y1 - r.y0;
    const gw = aw - gdx;
    const gh = ah - gdy;
    const ref = `bay:${r.bay}/field:${r.field}`;
    if (gw <= EPS || gh <= EPS) {
      issues.push({ code: 'GLASS_SIZE_NONPOSITIVE', severity: 'error', message: `Computed fill size ${gw}x${gh} is not positive`, ref });
      continue;
    }
    let desc: string;
    let gid: string | null;
    let pid: string | null;
    let mk: string;
    if (f.type === 'panel') {
      const pt = getPanelType(cat, f.panel_type_id)!;
      desc = `Panel ${pt.code} - ${pt.name}`;
      gid = null;
      pid = pt.id;
      mk = 'P';
    } else {
      const gt = f.glass_type_id ? getGlassType(cat, f.glass_type_id) : null;
      desc = `${f.type === 'spandrel' ? 'Spandrel' : 'Glass'} ` + (gt ? `${gt.code} - ${gt.name}` : '(type not specified)');
      gid = f.glass_type_id ?? null;
      pid = null;
      mk = f.type === 'spandrel' ? 'SP' : 'G';
    }
    glass.push({
      mark: `${mk}${r.bay + 1}.${r.field + 1}`,
      field_key: r.key,
      fill_type: f.type,
      glass_type_id: gid,
      panel_type_id: pid,
      description: desc,
      width: roundTo(gw, 6),
      height: roundTo(gh, 6),
      area_m2: (roundTo(gw, 6) * roundTo(gh, 6)) / 1e6,
      quantity: q,
      formula: `W = axis width - glass_deduction_x = ${_fmt(aw)} - ${_fmt(gdx)} = ${_fmt(gw)}; H = axis height - glass_deduction_y = ${_fmt(ah)} - ${_fmt(gdy)} = ${_fmt(gh)}`,
      rule_ids: [`${RS}:glass_deduction_x`, `${RS}:glass_deduction_y`],
    });
    fillPerimeterMm += 2 * (gw + gh);
    paneCount += 1;
  }

  if (issues.some((i) => i.severity === 'error')) return result([], [], [], {}, 'INVALID');

  // --- BOM ---
  const bom: BomLine[] = [];
  const profLen = new Map<string, number>();
  const profObj = new Map<string, CatProfile>();
  for (const c of cuts) {
    profLen.set(c.profile_id, (profLen.get(c.profile_id) ?? 0) + c.length * c.quantity);
    profObj.set(c.profile_id, getProfile(cat, c.profile_id)!);
  }
  const totals: Record<string, number> = {};
  let weight = 0;
  for (const [pid, totalMm] of profLen) {
    const p = profObj.get(pid)!;
    const stock = Math.max(...(p.stock_lengths?.length ? p.stock_lengths : [0])) || null;
    let est = '';
    if (stock) {
      let sum = 0;
      let any = false;
      for (const c of cuts) if (c.profile_id === pid && c.length <= stock) {
        sum += c.length * c.quantity;
        any = any || c.quantity > 0;
      }
      const barsLb = any ? Math.ceil(sum / stock - 1e-9) : 0;
      totals[`bars_lower_bound.${pid}`] = barsLb;
      est = ` (bar lower-bound estimate: ${barsLb} x ${_fmt(stock)} mm; run 1D optimisation for actual)`;
    }
    bom.push({ item_type: 'profile', item_id: pid, code: p.code, description: p.name + est, unit: 'm', quantity: totalMm / 1000, rule_ids: ['sum(cut length x qty)'], demo_data: true });
    weight += (totalMm / 1000) * Number(p.weight_kg_m ?? 0);
  }

  const gArea = new Map<string, number>();
  const pArea = new Map<string, number>();
  for (const gi of glass) {
    if (gi.fill_type === 'panel') pArea.set(gi.panel_type_id!, (pArea.get(gi.panel_type_id!) ?? 0) + gi.area_m2 * gi.quantity);
    else {
      const k = gi.glass_type_id || 'unspecified';
      gArea.set(k, (gArea.get(k) ?? 0) + gi.area_m2 * gi.quantity);
    }
  }
  let glassWeight = 0;
  for (const [gid, a] of gArea) {
    const gt = gid !== 'unspecified' ? getGlassType(cat, gid) : null;
    bom.push({ item_type: 'glass', item_id: gid, code: gt ? gt.code : 'UNSPECIFIED', description: gt ? gt.name : 'Glass type not specified', unit: 'm2', quantity: a, rule_ids: ['sum(glass area x qty)'], demo_data: true });
    if (gt?.weight_kg_m2) glassWeight += a * gt.weight_kg_m2;
  }
  for (const [pid, a] of pArea) {
    const pt = getPanelType(cat, pid)!;
    bom.push({ item_type: 'panel', item_id: pid, code: pt.code, description: pt.name, unit: 'm2', quantity: a, rule_ids: ['sum(panel area x qty)'], demo_data: true });
  }

  const sid = series?.id ?? null;
  const accLine = (kind: string, itemType: BomLine['item_type'], quantity: number, rule: string, fallbackUnit: BomLine['unit']) => {
    if (quantity <= 0) return;
    const a = findAccessory(cat, kind, sid);
    if (!a) {
      issues.push({ code: 'ACCESSORY_NOT_IN_CATALOGUE', severity: 'warning', message: `No '${kind}' accessory for series ${sid}; quantity ${_fmt(quantity)} not costed`, ref: `bom:${kind}` });
      return;
    }
    bom.push({ item_type: itemType, item_id: a.id, code: a.code, description: a.name, unit: (a.unit || fallbackUnit) as BomLine['unit'], quantity, rule_ids: [rule], demo_data: true });
  };
  accLine('gasket', 'gasket', (fillPerimeterMm / 1000) * P.gasket_runs_per_field_edge * q, `${RS}:gasket_runs_per_field_edge (x fill perimeter)`, 'm');
  accLine('connector', 'connector', P.connectors_per_transom * nHorizontal * q, `${RS}:connectors_per_transom (x horizontal members incl. sill & head)`, 'pcs');
  accLine('bracket', 'bracket', P.brackets_per_anchor * elev.anchor_levels.length * nM * q, `${RS}:brackets_per_anchor (x anchor levels x mullions)`, 'pcs');
  accLine('end_cap', 'accessory', (P.end_caps_per_mullion ?? 0) * nM * q, `${RS}:end_caps_per_mullion`, 'pcs');
  accLine('sealant', 'sealant', ((2 * (W + H)) / 1000) * (P.sealant_runs_per_perimeter ?? 0) * q, `${RS}:sealant_runs_per_perimeter (x framework perimeter)`, 'm');
  let splices = 0;
  for (const c of cuts) if (c.length > P.max_bar_length + EPS) splices += (Math.ceil(c.length / P.max_bar_length) - 1) * c.quantity;
  accLine('splice', 'accessory', splices * (P.splice_sleeves_per_splice ?? 1), `${RS}:max_bar_length / splice_sleeves_per_splice (count only, positions not computed)`, 'pcs');

  const sum = (it: Iterable<number>) => {
    let s = 0;
    for (const v of it) s += v;
    return s;
  };
  Object.assign(totals, {
    glass_area_m2: sum(gArea.values()),
    panel_area_m2: sum(pArea.values()),
    profile_length_m: sum(profLen.values()) / 1000,
    field_count: fieldRects(elev).length,
    fill_count: paneCount,
    mullion_count: nM * q,
    transom_count: sum(elev.bays.map((b) => b.transoms.length)) * q,
    horizontal_member_count: nHorizontal * q,
    elevation_area_m2: ((W * H) / 1e6) * q,
    profile_weight_kg_demo: weight,
    glass_weight_kg_demo: glassWeight,
    quantity: q,
  });
  let status: CalcResult['validation_status'];
  if (approved && rs.golden_cases_passed === true) status = 'VALIDATED';
  else {
    status = 'PROVISIONAL_DEMO_RULES';
    issues.push({ code: 'PROVISIONAL_DEMO_RULES', severity: 'info', message: 'Calculated with DEMO rule set (not approved). Not for production/fabrication.', ref: `rule_set:${RS}` });
  }
  return result(cuts, glass, bom, totals, status);
}
