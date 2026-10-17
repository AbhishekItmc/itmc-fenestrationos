import { create } from 'zustand';

/** Status-bar feed: written by whichever screen is active (editor writes cursor/selection/snap). */
interface StatusState {
  cursor: { x: number; y: number } | null;
  selection: string;
  snap: string;
  validation: { errors: number; warnings: number } | null;
  set(p: Partial<Omit<StatusState, 'set' | 'reset'>>): void;
  reset(): void;
}

export const useStatus = create<StatusState>((set) => ({
  cursor: null,
  selection: '—',
  snap: '—',
  validation: null,
  set: (p) => set(p),
  reset: () => set({ cursor: null, selection: '—', snap: '—', validation: null }),
}));
