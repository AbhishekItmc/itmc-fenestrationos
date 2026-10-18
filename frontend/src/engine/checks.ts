/**
 * Design checks (ARCHITECTURE §8.3) — TS port of backend/app/engines/checks.py.
 * DEMO plausibility warnings, NOT structural verification. Every threshold is a rule-set param (DEMO,
 * approved: false). Every message ends with "(demo threshold — requires engineering approval)".
 * Geometry-invalid elevations are skipped (the elevation validator reports those errors).
 */
import type { Catalogue, Elevation, Issue } from '../api/types';
import { getGlassType } from './catalogue';
import { fieldRects, resolveFill, resolveRuleSet } from './elevation';
import { EPS } from './units';

export const DESIGN_CHECK_SUFFIX = ' (demo threshold — requires engineering approval)';
export const CHECK_PARAMS = ['max_glass_weight_kg', 'max_field_area_m2', 'max_field_aspect_ratio', 'max_unsupported_mullion_span', 'min_anchor_levels'] as const;
export const DESIGN_CHECK_CODES = new Set(['GLASS_WEIGHT_HIGH', 'FIELD_AREA_HIGH', 'FIELD_ASPECT_HIGH', 'MULLION_SPAN_HIGH', 'ANCHORS_MISSING', 'NO_COLOUR_SELECTED', 'DESIGN_CHECK_PARAM_MISSING']);

export const isDesignCheck = (i: Issue): boolean => DESIGN_CHECK_CODES.has(i.code);

const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** Python `_g`: thousands-grouped, 1 decimal trimmed, or integer. */
function g(v: number): string {
  if (Math.abs(v - Math.round(v)) > 1e-9) {
    const [i, d] = Math.abs(v).toFixed(1).split('.');
    const s = `${v < 0 ? '-' : ''}${group(i)}.${d}`;
    return s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return `${v < 0 && Math.round(v) !== 0 ? '-' : ''}${group(String(Math.abs(Math.round(v))))}`;
}
/** Python `:g` for the moderate magnitudes used by thresholds. */
const gg = (v: number) => String(Number(v.toPrecision(6)));

function geometryOk(elev: Elevation): boolean {
  const m = elev.mullions;
  if (m.length < 2 || elev.bays.length !== m.length - 1) return false;
  if (Math.abs(m[0]) > EPS || Math.abs(m[m.length - 1] - elev.width) > EPS) return false;
  for (let i = 1; i < m.length; i++) if (m[i] - m[i - 1] <= EPS) return false;
  for (const bay of elev.bays) {
    const ys = [0, ...bay.transoms, elev.height];
    for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] <= EPS) return false;
  }
  return true;
}

/** Unsupported vertical spans: between anchor levels plus the cantilevers to y=0 and y=H. No anchors → [H]. */
export function mullionSpans(elev: Elevation): number[] {
  const H = Number(elev.height);
  const levels = [...new Set(elev.anchor_levels.map((a) => Math.min(Math.max(Number(a), 0), H)))].sort((a, b) => a - b);
  if (!levels.length) return [H];
  const pts = [0, ...levels, H];
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > EPS) out.push(pts[i] - pts[i - 1]);
  return out;
}

export function runDesignChecks(elev: Elevation, cat: Catalogue | null, ruleSetId: string | null = null): Issue[] {
  const issues: Issue[] = [];
  if (!geometryOk(elev)) return issues;
  const warn = (code: string, msg: string, ref: string | null) => issues.push({ code, severity: 'warning', message: msg + DESIGN_CHECK_SUFFIX, ref });

  if (!elev.colour_id) warn('NO_COLOUR_SELECTED', 'No colour/finish selected for the elevation; colour surcharge and finish are not costed', 'elevation:colour_id');

  const rs = cat ? resolveRuleSet(elev, cat, ruleSetId) : null;
  const P: Record<string, number | null | undefined> = rs?.params ?? {};
  const missing = CHECK_PARAMS.filter((p) => P[p] === undefined || P[p] === null);
  if (rs && missing.length)
    issues.push({ code: 'DESIGN_CHECK_PARAM_MISSING', severity: 'info', message: `Rule set '${rs.id}' lacks design-check params: ${missing.join(', ')}; those checks were not run`, ref: `rule_set:${rs.id}` });
  if (!rs || !cat) return issues;

  const gdx = Number(P.glass_deduction_x ?? 0) || 0;
  const gdy = Number(P.glass_deduction_y ?? 0) || 0;
  const maxW = P.max_glass_weight_kg;
  const maxA = P.max_field_area_m2;
  const maxR = P.max_field_aspect_ratio;
  for (const r of fieldRects(elev)) {
    const ref = `bay:${r.bay}/field:${r.field}`;
    const aw = r.x1 - r.x0;
    const ah = r.y1 - r.y0;
    const label = `Field b${r.bay + 1}.f${r.field + 1} (${g(aw)} x ${g(ah)} mm axis)`;
    const area = (aw * ah) / 1e6;
    if (maxA != null && area > Number(maxA) + 1e-9) warn('FIELD_AREA_HIGH', `${label}: area ${area.toFixed(2)} m² exceeds max_field_area_m2 ${gg(Number(maxA))} m²`, ref);
    const ratio = Math.max(aw, ah) / Math.min(aw, ah);
    if (maxR != null && ratio > Number(maxR) + 1e-9) warn('FIELD_ASPECT_HIGH', `${label}: aspect ratio ${ratio.toFixed(2)} exceeds max_field_aspect_ratio ${gg(Number(maxR))}`, ref);
    const f = resolveFill(elev, r.key);
    if (maxW != null && (f.type === 'glass' || f.type === 'spandrel') && f.glass_type_id) {
      const gt = getGlassType(cat, f.glass_type_id);
      const kgM2 = gt?.weight_kg_m2;
      if (gt && kgM2) {
        const gw = Math.max(aw - gdx, 0);
        const gh = Math.max(ah - gdy, 0);
        const kg = ((gw * gh) / 1e6) * Number(kgM2);
        if (kg > Number(maxW) + 1e-9)
          warn('GLASS_WEIGHT_HIGH', `${label}: pane ${gt.code} ${g(gw)} x ${g(gh)} mm weighs about ${kg.toFixed(0)} kg (demo ${gg(Number(kgM2))} kg/m²), exceeds max_glass_weight_kg ${gg(Number(maxW))} kg`, ref);
      }
    }
  }

  const minAnchors = P.min_anchor_levels;
  const nAnchor = new Set(elev.anchor_levels.map(Number)).size;
  if (minAnchors != null && nAnchor < Math.trunc(Number(minAnchors)))
    warn('ANCHORS_MISSING', `${nAnchor} anchor level(s) defined, min_anchor_levels is ${Math.trunc(Number(minAnchors))}; bracket quantities and mullion spans are unreliable`, 'elevation:anchor_levels');
  const maxSpan = P.max_unsupported_mullion_span;
  if (maxSpan != null) {
    const worst = Math.max(...mullionSpans(elev));
    if (worst > Number(maxSpan) + EPS)
      warn('MULLION_SPAN_HIGH', `Largest unsupported mullion span ${g(worst)} mm (between anchor levels / framework ends) exceeds max_unsupported_mullion_span ${g(Number(maxSpan))} mm`, 'elevation:anchor_levels');
  }
  return issues;
}
