import { create } from 'zustand';
import type { Cutting1DResult, Id, Piece1D, Stock1D, Strategy1D } from '../../api/types';
import { loadJson, saveJson } from '../../lib/storage';

export interface StockRow extends Stock1D {
  unlimited: boolean;
}

export interface CuttingDraft {
  name: string;
  material: string;
  kerf: number;
  trim_start: number;
  trim_end: number;
  min_reusable_offcut: number;
  strategy: Strategy1D;
  useInventory: boolean;
  stocks: StockRow[];
  pieces: Piece1D[];
  source: string | null;
}

export const emptyCuttingDraft = (): CuttingDraft => ({
  name: 'Cutting job',
  material: '',
  kerf: 4,
  trim_start: 10,
  trim_end: 0,
  min_reusable_offcut: 500,
  strategy: 'auto',
  useInventory: false,
  stocks: [{ id: 'S6000', label: 'Stock bar 6000', length: 6000, quantity: null, unlimited: true, is_offcut: false }],
  pieces: [],
  source: null,
});

/** "Load demo: mullions & transoms" — fictitious demo dataset. */
export const demoCuttingDraft = (): CuttingDraft => ({
  ...emptyCuttingDraft(),
  name: 'Demo — mullions & transoms (fictitious)',
  material: 'DEMO-CW50-M150',
  stocks: [
    { id: 'S6000', label: 'Stock bar 6000', length: 6000, quantity: null, unlimited: true, is_offcut: false },
    { id: 'S6500', label: 'Stock bar 6500', length: 6500, quantity: 6, unlimited: false, is_offcut: false },
    { id: 'OFF-2350', label: 'Offcut 2350 (rack)', length: 2350, quantity: 2, unlimited: false, is_offcut: true },
  ],
  pieces: [
    { id: 'M1', label: 'Mullion level 1', length: 4300, quantity: 6, angle_start: 90, angle_end: 90 },
    { id: 'M2', label: 'Mullion level 2', length: 3650, quantity: 4, angle_start: 90, angle_end: 90 },
    { id: 'T1', label: 'Transom bay A', length: 1449, quantity: 12, angle_start: 90, angle_end: 90 },
    { id: 'T2', label: 'Transom bay B', length: 1199, quantity: 9, angle_start: 90, angle_end: 90 },
    { id: 'T3', label: 'Sill / head', length: 949, quantity: 8, angle_start: 90, angle_end: 90 },
  ],
  source: 'demo dataset',
});

interface CuttingState {
  draft: CuttingDraft;
  result: Cutting1DResult | null;
  jobId: Id | null;
  setDraft(p: Partial<CuttingDraft>): void;
  replaceDraft(d: CuttingDraft): void;
  setResult(r: Cutting1DResult | null, jobId?: Id | null): void;
}

const KEY = 'fos.cutting.draft';

export const useCutting = create<CuttingState>((set, get) => ({
  draft: loadJson<CuttingDraft>(KEY, emptyCuttingDraft()),
  result: null,
  jobId: null,
  setDraft(p) {
    const draft = { ...get().draft, ...p };
    saveJson(KEY, draft);
    set({ draft, jobId: null });
  },
  replaceDraft(d) {
    saveJson(KEY, d);
    set({ draft: d, result: null, jobId: null });
  },
  setResult(result, jobId = null) {
    set({ result, jobId });
  },
}));
