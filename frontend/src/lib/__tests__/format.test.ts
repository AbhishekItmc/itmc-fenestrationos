import { describe, expect, it } from 'vitest';
import { fmtG } from '../../engine/units';
import { fmtArea, fmtDim, fmtM, fmtMm, fmtPct, fmtQty, parseLength } from '../format';

describe('dimension formatting', () => {
  it('formats millimetres', () => {
    expect(fmtMm(4500)).toBe('4500');
    expect(fmtMm(1234.5)).toBe('1234.5');
    expect(fmtMm(1234.56)).toBe('1234.6');
    expect(fmtMm(1234.04)).toBe('1234');
    expect(fmtMm(-0.01)).toBe('0');
    expect(fmtMm(null)).toBe('—');
    expect(fmtMm(NaN)).toBe('—');
    expect(fmtDim(999.95)).toBe('1000');
  });
  it('formats ratios, metres and areas', () => {
    expect(fmtPct(0.87345)).toBe('87.3 %');
    expect(fmtM(12345)).toBe('12.35 m');
    expect(fmtArea(3.14159)).toBe('3.14 m²');
    expect(fmtQty(12, 'pcs')).toBe('12 pcs');
    expect(fmtQty(2.5, 'm2')).toBe('2.50 m²');
  });
  it('parses user lengths with units', () => {
    expect(parseLength('1500')).toBe(1500);
    expect(parseLength(' 1 234,5 ')).toBe(1234.5);
    expect(parseLength('1.2m')).toBe(1200);
    expect(parseLength('120 cm')).toBe(1200);
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('')).toBeNull();
  });
  it('fmtG mirrors Python {:g}', () => {
    expect(fmtG(3100)).toBe('3100');
    expect(fmtG(25)).toBe('25');
    expect(fmtG(1234.5678)).toBe('1234.57');
    expect(fmtG(0.5)).toBe('0.5');
    expect(fmtG(12345678)).toBe('1.23457e+07');
    expect(fmtG(0.00001234)).toBe('1.234e-05');
    expect(fmtG(-42.0)).toBe('-42');
    expect(fmtG(1449)).toBe('1449');
  });
});
