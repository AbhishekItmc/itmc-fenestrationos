import { create } from 'zustand';
import { getToken, setToken } from '../api/client';
import type { Catalogue, ElevationRecord, Id, Project, User } from '../api/types';
import { DEMO_CATALOGUE } from '../engine/catalogue';
import { loadJson, saveJson } from '../lib/storage';
import type { Backend, Mode } from '../services/backend';
import { offlineBackend, OFFLINE_USER } from '../services/offlineBackend';
import { serverBackend } from '../services/serverBackend';

export type Phase = 'checking' | 'choose' | 'login' | 'ready';

interface Prefs {
  projectId: Id | null;
  elevationId: Id | null;
}

interface AppState {
  phase: Phase;
  mode: Mode | null;
  serverReachable: boolean;
  user: User | null;
  catalogue: Catalogue;
  catalogueSource: 'server' | 'bundled';
  projects: Project[];
  elevations: ElevationRecord[];
  projectId: Id | null;
  elevationId: Id | null;
  setPhase(p: Phase): void;
  enterServer(user: User | null): void;
  enterOffline(): void;
  logout(): void;
  setCatalogue(c: Catalogue, source: 'server' | 'bundled'): void;
  setProjects(p: Project[]): void;
  setElevations(e: ElevationRecord[]): void;
  selectProject(id: Id | null): void;
  selectElevation(id: Id | null): void;
}

const prefsKey = (mode: Mode | null) => `fos.prefs.${mode ?? 'none'}`;

export const useApp = create<AppState>((set, get) => ({
  phase: 'checking',
  mode: null,
  serverReachable: false,
  user: null,
  catalogue: DEMO_CATALOGUE,
  catalogueSource: 'bundled',
  projects: [],
  elevations: [],
  projectId: null,
  elevationId: null,
  setPhase: (phase) => set({ phase }),
  enterServer(user) {
    const prefs = loadJson<Prefs>(prefsKey('server'), { projectId: null, elevationId: null });
    set({ mode: 'server', serverReachable: true, user, phase: user ? 'ready' : 'login', ...prefs });
  },
  enterOffline() {
    try {
      sessionStorage.setItem('fos.mode', 'offline');
    } catch {
      /* ignore */
    }
    const prefs = loadJson<Prefs>(prefsKey('offline'), { projectId: 1, elevationId: 11 });
    set({ mode: 'offline', user: OFFLINE_USER, phase: 'ready', catalogue: DEMO_CATALOGUE, catalogueSource: 'bundled', ...prefs });
  },
  logout() {
    setToken(null);
    try {
      sessionStorage.removeItem('fos.mode');
    } catch {
      /* ignore */
    }
    const { mode } = get();
    set({ user: null, phase: mode === 'server' ? 'login' : 'choose', projects: [], elevations: [] });
  },
  setCatalogue: (catalogue, catalogueSource) => set({ catalogue, catalogueSource }),
  setProjects: (projects) => set({ projects }),
  setElevations: (elevations) => set({ elevations }),
  selectProject(id) {
    set({ projectId: id, elevationId: id === get().projectId ? get().elevationId : null, elevations: id === get().projectId ? get().elevations : [] });
    saveJson(prefsKey(get().mode), { projectId: get().projectId, elevationId: get().elevationId });
  },
  selectElevation(id) {
    set({ elevationId: id });
    saveJson(prefsKey(get().mode), { projectId: get().projectId, elevationId: id });
  },
}));

/** Backend for the current mode (offline when undecided so pure screens still render). */
export function backend(): Backend {
  return useApp.getState().mode === 'server' ? serverBackend : offlineBackend;
}

export function useBackend(): Backend {
  const mode = useApp((s) => s.mode);
  return mode === 'server' ? serverBackend : offlineBackend;
}

export const hasStoredToken = () => !!getToken();

export function canWrite(user: User | null, area: 'engineering' | 'project' | 'admin' | 'quote' | 'production' | 'operate' | 'purchase'): boolean {
  if (!user) return false;
  const r = user.role;
  if (area === 'production') return r === 'admin' || r === 'engineer';
  if (area === 'operate') return r === 'admin' || r === 'engineer' || r === 'operator';
  if (area === 'purchase') return r === 'admin' || r === 'engineer' || r === 'estimator';
  if (area === 'admin') return r === 'admin';
  if (area === 'engineering') return r === 'admin' || r === 'engineer';
  if (area === 'quote') return r === 'admin' || r === 'estimator';
  return r === 'admin' || r === 'engineer' || r === 'estimator';
}

export function offlineChosen(): boolean {
  try {
    return sessionStorage.getItem('fos.mode') === 'offline';
  } catch {
    return false;
  }
}
