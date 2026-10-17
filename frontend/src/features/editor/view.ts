/** Canvas viewport: px-per-mm scale and screen offset of the world origin (x right, y up → screen y down). */
import { create } from 'zustand';
import type { Elevation } from '../../api/types';

export const MIN_SCALE = 0.005;
export const MAX_SCALE = 4;
export const FIT_MARGIN = { left: 116, right: 98, top: 46, bottom: 112 };

export interface ViewState {
  scale: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  setSize(w: number, h: number): void;
  fit(e: Elevation): void;
  zoomAt(factor: number, cx: number, cy: number): void;
  zoomCenter(factor: number): void;
  panBy(dx: number, dy: number): void;
}

export function fitView(e: Elevation, w: number, h: number) {
  const rise = e.top_shape?.type === 'arch' ? e.top_shape.rise : 0;
  const availW = Math.max(40, w - FIT_MARGIN.left - FIT_MARGIN.right);
  const availH = Math.max(40, h - FIT_MARGIN.top - FIT_MARGIN.bottom);
  const totalH = e.height + rise;
  const scale = Math.min(availW / e.width, availH / totalH);
  const tx = FIT_MARGIN.left + (availW - e.width * scale) / 2;
  const ty = h - FIT_MARGIN.bottom - (availH - totalH * scale) / 2;
  return { scale, tx, ty };
}

export const useView = create<ViewState>((set, get) => ({
  scale: 0.1,
  tx: 100,
  ty: 600,
  w: 0,
  h: 0,
  setSize(w, h) {
    set({ w, h });
  },
  fit(e) {
    const { w, h } = get();
    set(fitView(e, w, h));
  },
  zoomAt(factor, cx, cy) {
    const { scale, tx, ty } = get();
    const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    const k = ns / scale;
    set({ scale: ns, tx: cx - (cx - tx) * k, ty: cy - (cy - ty) * k });
  },
  zoomCenter(factor) {
    const { w, h } = get();
    get().zoomAt(factor, w / 2, h / 2);
  },
  panBy(dx, dy) {
    set({ tx: get().tx + dx, ty: get().ty + dy });
  },
}));

/** Drawing scale as 1:N on a 96-dpi screen (1 px ≈ 0.2646 mm). */
export function drawingScaleLabel(scale: number): string {
  const n = 1 / (scale * 0.264583);
  const nice = n >= 10 ? Math.round(n / 5) * 5 : Math.round(n);
  return `1:${nice}`;
}
