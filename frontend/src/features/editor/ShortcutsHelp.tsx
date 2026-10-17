import { Dialog } from '../../ui/Dialog';

export const SHORTCUTS: [string, string][] = [
  ['V', 'Select tool'],
  ['M', 'Add mullion tool (click position)'],
  ['T', 'Add transom tool (click in bay)'],
  ['A', 'Toggle "transom in all bays"'],
  ['D', 'Delete tool (click member)'],
  ['S', 'Split field tool'],
  ['P', 'Paint fill tool'],
  ['H  /  Space + drag', 'Hand / pan (also middle mouse)'],
  ['Del / Backspace', 'Delete selected mullion or transom'],
  ['1 … 5', 'Set fill of selected fields: glass, spandrel, panel, none, vent'],
  ['← → ↑ ↓', 'Nudge selected member by snap step (Shift ×10)'],
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Y  /  Ctrl + Shift + Z', 'Redo'],
  ['Ctrl + S', 'Save'],
  ['Ctrl + A', 'Select all fields'],
  ['F', 'Fit drawing to screen'],
  ['+  /  −', 'Zoom in / out'],
  ['G', 'Toggle grid'],
  ['Esc', 'Cancel drag / back to select tool / clear selection'],
  ['?', 'This help'],
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" subtitle="Elevation CAD editor" width={560} testId="shortcuts-help">
      <table className="dense">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <td className="w-[200px]">
                {k.split('  /  ').map((part, i) => (
                  <span key={i}>
                    {i > 0 && <span className="px-1 text-faint">/</span>}
                    {part.split(' + ').map((p, j) => (
                      <span key={j}>
                        {j > 0 && <span className="px-0.5 text-faint">+</span>}
                        <span className="kbd">{p}</span>
                      </span>
                    ))}
                  </span>
                ))}
              </td>
              <td className="text-muted">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
