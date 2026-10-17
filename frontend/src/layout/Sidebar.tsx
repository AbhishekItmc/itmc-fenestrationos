import clsx from 'clsx';
import { Boxes, Calculator, ChevronsLeft, ChevronsRight, FileBarChart2, FolderKanban, LayoutGrid, Library, Layers3, PenTool, ReceiptText, Ruler, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { loadJson, saveJson } from '../lib/storage';

const groups = [
  {
    label: 'Design',
    items: [
      { to: '/projects', label: 'Projects', icon: FolderKanban },
      { to: '/editor', label: 'Elevation CAD', icon: PenTool },
      { to: '/catalogue', label: 'Catalogue', icon: Library },
      { to: '/glass', label: 'Glass & Panels', icon: Layers3 },
    ],
  },
  {
    label: 'Engineering',
    items: [
      { to: '/calc', label: 'Calculation / BOM', icon: Calculator },
      { to: '/cutting', label: '1D Cutting', icon: Ruler },
      { to: '/nesting', label: '2D Nesting', icon: LayoutGrid },
      { to: '/inventory', label: 'Inventory', icon: Boxes },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { to: '/quotes', label: 'Quotations', icon: ReceiptText },
      { to: '/reports', label: 'Reports', icon: FileBarChart2 },
    ],
  },
  { label: 'System', items: [{ to: '/admin', label: 'Admin / Audit', icon: ShieldCheck }] },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => loadJson('fos.sidebar.collapsed', false));
  const toggle = () => {
    saveJson('fos.sidebar.collapsed', !collapsed);
    setCollapsed(!collapsed);
  };
  return (
    <nav className={clsx('flex shrink-0 flex-col border-r border-line bg-panel transition-[width]', collapsed ? 'w-[52px]' : 'w-[184px]')} aria-label="Main">
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            {!collapsed && <div className="section-title px-4 pb-1 pt-2">{g.label}</div>}
            {collapsed && <div className="mx-3 my-2 border-t border-line" />}
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                data-tip={collapsed ? it.label : undefined}
                data-tip-pos="right"
                className={({ isActive }) =>
                  clsx(
                    'group relative mx-2 flex h-8 items-center gap-2.5 rounded px-2.5 text-sm transition-colors',
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
      </div>
      <button onClick={toggle} className="flex h-8 items-center gap-2 border-t border-line px-4 text-xs text-faint hover:text-fg" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        {!collapsed && 'Collapse'}
      </button>
    </nav>
  );
}
