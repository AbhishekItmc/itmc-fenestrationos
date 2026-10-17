import { describe, expect, it } from 'vitest';
import { piecesFromTsv2D } from '../../nesting/NestingPage';
import { piecesFromTsv } from '../CuttingPage';

describe('paste from Excel (TSV)', () => {
  it('parses 1D pieces, skipping header and invalid rows', () => {
    const { pieces, skipped } = piecesFromTsv('Mark\tLength\tQty\nM1\t4300\t6\nT1\t1449,5\t12\t45\t90\tTransom A\nBAD\t-1\t2\n\n');
    expect(pieces).toEqual([
      { id: 'M1', length: 4300, quantity: 6, angle_start: 90, angle_end: 90, label: null },
      { id: 'T1', length: 1449.5, quantity: 12, angle_start: 45, angle_end: 90, label: 'Transom A' },
    ]);
    expect(skipped).toBe(3);
  });
  it('parses 2D pieces with rotation flag', () => {
    expect(piecesFromTsv2D('G1\t1480\t1780\t6\tno\nG2\t980\t1180\t8')).toEqual([
      { id: 'G1', width: 1480, height: 1780, quantity: 6, can_rotate: false, label: null },
      { id: 'G2', width: 980, height: 1180, quantity: 8, can_rotate: true, label: null },
    ]);
  });
});
