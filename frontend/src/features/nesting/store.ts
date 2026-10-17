import { create } from 'zustand';
import type { EdgeTrim, Id, Nesting2DResult, Piece2D, Sheet2D } from '../../api/types';
import { loadJson, saveJson } from '../../lib/storage';

export interface SheetRow extends Sheet2D {
  unlimited: boolean;
}

export interface NestingDraft {
  name: string;
  kerf: number;
  edge_trim: EdgeTrim;
  guillotine: boolean;
  min_residual_width: number;
  min_residual_height: number;
  sheets: SheetRow[];
  pieces: Piece2D[];
  source: string | null;
}

export const emptyNestingDraft = (): NestingDraft => ({
  name: 'Nesting job',
  kerf: 3,
  edge_trim: { left: 10, right: 10, top: 10, bottom: 10 },
  guillotine: true,
  min_residual_width: 300,
  min_residual_height: 300,
  sheets: [{ id: 'JUMBO', label: 'Jumbo 6000×3210 (demo)', width: 6000, height: 3210, quantity: null, unlimited: true, is_residual: false }],
  pieces: [],
  source: null,
});

export const demoNestingDraft = (): NestingDraft => ({
  ...emptyNestingDraft(),
  name: 'Demo — IGU lites (fictitious)',
  sheets: [
    { id: 'JUMBO', label: 'Jumbo 6000×3210 (demo)', width: 6000, height: 3210, quantity: null, unlimited: true, is_residual: false },
    { id: 'RES-1', label: 'Residual 2400×1600', width: 2400, height: 1600, quantity: 1, unlimited: false, is_residual: true },
  ],
  pieces: [
    { id: 'G1', label: 'Vision lite L1', width: 1480, height: 1780, quantity: 6, can_rotate: true },
    { id: 'G2', label: 'Vision lite L2', width: 980, height: 1180, quantity: 8, can_rotate: true },
    { id: 'G3', label: 'Transom lite (no rotation)', width: 1480, height: 580, quantity: 5, can_rotate: false },
    { id: 'SP1', label: 'Spandrel', width: 1180, height: 830, quantity: 4, can_rotate: true },
  ],
  source: 'demo dataset',
});

interface NestingState {
  draft: NestingDraft;
  result: Nesting2DResult | null;
  jobId: Id | null;
  setDraft(p: Partial<NestingDraft>): void;
  replaceDraft(d: NestingDraft): void;
  setResult(r: Nesting2DResult | null, jobId?: Id | null): void;
}

const KEY = 'fos.nesting.draft';

export const useNesting = create<NestingState>((set, get) => ({
  draft: loadJson<NestingDraft>(KEY, emptyNestingDraft()),
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
