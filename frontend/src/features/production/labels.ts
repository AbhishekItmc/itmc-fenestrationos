import type { LabelLayout } from '../../api/types';

export const LABEL_LAYOUTS: { value: LabelLayout; label: string; detail: string }[] = [
  { value: 'a4-24', label: 'A4 · 24 labels', detail: '3 × 8, 70 × 37 mm' },
  { value: 'a4-8', label: 'A4 · 8 labels', detail: '2 × 4, 105 × 74 mm' },
  { value: 'roll-62x29', label: 'Roll · 62 × 29 mm', detail: 'one label per page' },
];
