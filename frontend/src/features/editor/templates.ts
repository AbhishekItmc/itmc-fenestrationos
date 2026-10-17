import type { Elevation } from '../../api/types';
import { makeGrid } from '../../engine/elevation';

export interface Template {
  id: string;
  name: string;
  description: string;
  build(): Elevation;
}

const base = { system_id: 'ser-cw50', default_glass_type_id: 'gl-dgu-24', colour_id: 'col-ral7016' };

export const TEMPLATES: Template[] = [
  {
    id: 'storefront',
    name: 'Storefront 3 × 2',
    description: '4500 × 3000, 3 bays, transom at 2400',
    build: () => {
      const e = makeGrid(4500, 3000, 3, 2, { ...base, name: 'Storefront 3×2', anchor_levels: [0, 3000] });
      e.bays.forEach((b) => (b.transoms = [2400]));
      return e;
    },
  },
  {
    id: 'podium',
    name: 'Podium with spandrel band',
    description: '6000 × 4200, 4 bays, spandrel at slab zone',
    build: () => {
      const e = makeGrid(6000, 4200, 4, 3, { ...base, name: 'Podium bay', anchor_levels: [0, 4200] });
      e.bays.forEach((b) => (b.transoms = [900, 3300]));
      e.fills = Object.fromEntries(e.bays.map((_, i) => [`b${i}-f0`, { type: 'spandrel' as const, glass_type_id: 'gl-spandrel-6' }]));
      return e;
    },
  },
  {
    id: 'ribbon',
    name: 'Ribbon window 5 bays',
    description: '7500 × 1800, single row',
    build: () => makeGrid(7500, 1800, 5, 1, { ...base, name: 'Ribbon window', default_glass_type_id: 'gl-dgu-28', anchor_levels: [0] }),
  },
  {
    id: 'entrance',
    name: 'Entrance screen',
    description: '4800 × 3600, wide centre bay, panel over door, vent',
    build: () => {
      const e = makeGrid(4800, 3600, 3, 2, { ...base, system_id: 'ser-cw65', default_glass_type_id: 'gl-dgu-28', colour_id: 'col-ano-nat', name: 'Entrance screen', anchor_levels: [0, 3600] });
      e.mullions = [0, 1400, 3400, 4800];
      e.bays[1].transoms = [2700];
      e.fills = { 'b1-f1': { type: 'panel', panel_type_id: 'pnl-alu-3' }, 'b0-f1': { type: 'opening' } };
      return e;
    },
  },
  {
    id: 'arch',
    name: 'Arched head (display only)',
    description: '3000 × 2700 + 600 rise — calculation not supported',
    build: () => ({ ...makeGrid(3000, 2700, 3, 2, { ...base, name: 'Arched screen' }), top_shape: { type: 'arch', rise: 600 } }),
  },
];
