import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastState {
  toasts: Toast[];
  push(kind: ToastKind, title: string, detail?: string, ttlMs?: number): void;
  dismiss(id: number): void;
}

let seq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(kind, title, detail, ttlMs) {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-4), { id, kind, title, detail }] });
    const ttl = ttlMs ?? (kind === 'error' ? 7000 : 3500);
    setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  success: (t: string, d?: string) => useToasts.getState().push('success', t, d),
  error: (t: string, d?: string) => useToasts.getState().push('error', t, d),
  info: (t: string, d?: string) => useToasts.getState().push('info', t, d),
  warning: (t: string, d?: string) => useToasts.getState().push('warning', t, d),
};
