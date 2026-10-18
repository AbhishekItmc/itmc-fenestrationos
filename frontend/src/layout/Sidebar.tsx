import clsx from 'clsx';
import {
  Boxes,
  Calculator,
  ChevronsLeft,
  ChevronsRight,
  Factory,
  FileBarChart2,
  FolderKanban,
  LayoutGrid,
  Library,
  Layers3,
  PenTool,
  ReceiptText,
  Ruler,
  ScanLine,
  ShieldCheck,
  ShoppingCart,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { loadJson, saveJson } from '../lib/storage';
import { useApp } from '../store/app';

export const NAV_GROUPS = [
  {
    label: 'Design',
    items: [
      { to: '/app/projects', label: 'Projects', icon: FolderKanban },
      { to: '/app/editor', label: 'Elevation CAD', icon: PenTool },
      { to: '/app/catalogue', label: 'Catalogue', icon: Library },
      { to: '/app/glass', label: 'Glass & Panels', icon: Layers3 },
    ],
  },
  {
    label: 'Engineering',
    items: [
      { to: '/app/calc', label: 'Calculation / BOM', icon: Calculator },
      { to: '/app/cutting', label: '1D Cutting', icon: Ruler },
      { to: '/app/nesting', label: '2D Nesting', icon: LayoutGrid },
      { to: '/app/inventory', label: 'Inventory', icon: Boxes },
    ],
  },
  {
    label: 'Manufacturing',
    items: [
      { to: '/app/production', label: 'Production', icon: Factory },
      { to: '/app/station', label: 'Workstation', icon: ScanLine },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { to: '/app/quotes', label: 'Quotations', icon: ReceiptText },
      { to: '/app/purchasing', label: 'Purchasing', icon: ShoppingCart },
      { to: '/app/reports', label: 'Reports', icon: FileBarChart2 },
    ],
  },
  { label: 'System', items: [{ to: '/app/admin', label: 'Admin / Audit', icon: ShieldCheck }] },
];

function NavItems({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <>
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="mb-2">
          {!collapsed && <div className="section-title px-4 pb-1 pt-2">{g.label}</div>}
          {collapsed && <div className="mx-3 my-2 border-t border-line" />}
          {g.items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              onClick={onNavigate}
              data-tip={collapsed ? it.label : undefined}
              data-tip-pos="right"
              className={({ isActive }) =>
                clsx(
                  'group relative mx-2 flex items-center gap-2.5 rounded px-2.5 text-sm transition-colors',
                  onNavigate ? 'h-10' : 'h-8',
                  isActive ? 'bg-accent/10 text-fg' : 'text-muted hover:bg-hover hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute -left-2 top-1.5 h-5 w-[2px] rounded-r bg-accent" />}
                  <it.icon className={clsx('h-4 w-4 shrink-0', isActive ? 'text-accent' : 'text-faint group-hover:text-muted')} strokeWidth={1.75} />
                  {!collapsed && <span className="truncate">{it.label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </>
  );
}

/** Desktop rail (≥ 900 px). */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => loadJson('fos.sidebar.collapsed', false));
  const toggle = () => {
    saveJson('fos.sidebar.collapsed', !collapsed);
    setCollapsed(!collapsed);
  };
  return (
    <nav className={clsx('flex shrink-0 flex-col border-r border-line bg-panel transition-[width]', collapsed ? 'w-[52px]' : 'w-[184px]')} aria-label="Main">
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <NavItems collapsed={collapsed} />
      </div>
      <button onClick={toggle} className="flex h-8 items-center gap-2 border-t border-line px-4 text-xs text-faint hover:text-fg" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        {!collapsed && 'Collapse'}
      </button>
    </nav>
  );
}

/** Phone / small tablet (< 900 px): off-canvas drawer with the project picker. */
export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { projects, projectId, selectProject } = useApp();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[rgb(var(--scrim)/0.45)] animate-fade-in" onMouseDown={onClose} data-testid="nav-drawer">
      <nav aria-label="Main" className="flex h-full w-[280px] max-w-[86vw] flex-col border-r border-line-strong bg-panel shadow-pop animate-slide-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex h-12 items-center gap-2 border-b border-line px-3">
          <span className="text-sm font-semibold">FenestrationOS</span>
          <button className="btn btn-ghost btn-icon ml-auto" onClick={onClose} aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-line p-3">
          <label className="label" htmlFor="drawer-project">
            Project
          </label>
          <select id="drawer-project" data-testid="drawer-project-select" className="input h-9" value={projectId ?? ''} onChange={(e) => selectProject(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— select project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <NavItems collapsed={false} onNavigate={onClose} />
        </div>
      </nav>
    </div>
  );
}
