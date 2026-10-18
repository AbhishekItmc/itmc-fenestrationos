import { describe, expect, it } from 'vitest';
import type { Elevation } from '../../api/types';
import { DEMO_CATALOGUE } from '../catalogue';
import { asciiText, DXF_LAYERS, elevationToDxf, num, parseDxfEntities } from '../dxf';
import { makeGrid } from '../elevation';
import cases from '../__fixtures__/dxf_cases.json';

const fixtures = cases as unknown as { name: string; elevation: Elevation; dxf: string; dxf_no_catalogue: string }[];

describe('DXF writer parity with backend/app/engines/dxf_export.py', () => {
  it.each(fixtures.map((c) => [c.name, c] as const))('%s (byte-identical)', (_n, c) => {
    expect(elevationToDxf(c.elevation, DEMO_CATALOGUE)).toBe(c.dxf);
    expect(elevationToDxf(c.elevation, null)).toBe(c.dxf_no_catalogue);
  });
});

describe('DXF structure', () => {
  const e = makeGrid(4500, 3600, 3, 2, { name: 'E01 — Test', system_id: 'ser-cw50', default_glass_type_id: 'gl-dgu-24' });
  e.fills = { 'b1-f1': { type: 'panel', panel_type_id: 'pnl-alu-3' }, 'b2-f0': { type: 'none' } };
  const text = elevationToDxf(e, DEMO_CATALOGUE);
  const lines = text.split('\n').slice(0, -1);

  it('is well-formed ASCII R12 with all sections and EOF', () => {
    expect(lines.length % 2).toBe(0);
    for (let i = 0; i < lines.length; i += 2) expect(Number.isInteger(Number(lines[i]))).toBe(true);
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
    expect(lines.slice(0, 4)).toEqual(['0', 'SECTION', '2', 'HEADER']);
    expect(text).toContain('$ACADVER\n1\nAC1009');
    expect(text).toContain('$INSUNITS\n70\n4');
    for (const s of ['HEADER', 'TABLES', 'ENTITIES']) expect(text).toContain(`0\nSECTION\n2\n${s}\n`);
    expect(lines.slice(-2)).toEqual(['0', 'EOF']);
  });
  it('declares every FOS layer', () => {
    for (const [name] of DXF_LAYERS) expect(text).toContain(`0\nLAYER\n2\n${name}\n`);
  });
  it('draws members, fields, marks and LINE+TEXT dimensions (no DIMENSION entities)', () => {
    const ents = parseDxfEntities(text);
    const count = (type: string, layer: string) => ents.filter((x) => x.type === type && x.layer === layer).length;
    expect(count('POLYLINE', 'FOS-MULLION')).toBe(4);
    expect(count('POLYLINE', 'FOS-TRANSOM')).toBe(3 * 3); // sill + transom + head per bay
    expect(count('POLYLINE', 'FOS-GLASS')).toBe(4);
    expect(count('POLYLINE', 'FOS-PANEL')).toBe(1);
    expect(count('TEXT', 'FOS-TEXT')).toBe(6 + 1); // one mark per field + title
    expect(ents.some((x) => x.type === 'DIMENSION')).toBe(false);
    // chained (3) + overall width, chained (2) + overall height
    expect(count('TEXT', 'FOS-DIM')).toBe(3 + 1 + 2 + 1);
    const dimTexts = ents.filter((x) => x.type === 'TEXT' && x.layer === 'FOS-DIM').map((x) => new Map(x.codes).get(1));
    expect(dimTexts).toEqual(expect.arrayContaining(['1500', '4500', '1800', '3600']));
    const m0 = ents.find((x) => x.type === 'POLYLINE' && x.layer === 'FOS-MULLION')!;
    expect(m0.vertices).toEqual([[-25, 0], [25, 0], [25, 3600], [-25, 3600]]); // face width 50 from the catalogue
    const marks = ents.filter((x) => x.type === 'TEXT' && x.layer === 'FOS-TEXT').map((x) => new Map(x.codes).get(1));
    expect(marks).toEqual(expect.arrayContaining(['G1.1', 'P2.2', 'NONE 3.1', 'E01 ? Test - 4500 x 3600 mm']));
  });
  it('number and text helpers', () => {
    expect(num(1500)).toBe('1500');
    expect(num(-0.00001)).toBe('0');
    expect(num(12.34567)).toBe('12.3457');
    expect(asciiText('E01 — façade ×2')).toBe('E01 ? fa?ade ?2');
  });
});
