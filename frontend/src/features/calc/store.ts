import { create } from 'zustand';
import type { CalcResult, Id } from '../../api/types';

export interface CalcEntry {
  result: CalcResult;
  runId: Id | null;
  elevationId: Id | null;
  projectId: Id | null;
  elevationName: string;
  at: string;
  engine: 'server' | 'offline';
}

interface CalcState {
  last: CalcEntry | null;
  setLast(e: CalcEntry): void;
  clear(): void;
}

export const useCalc = create<CalcState>((set) => ({
  last: null,
  setLast: (last) => set({ last }),
  clear: () => set({ last: null }),
}));
