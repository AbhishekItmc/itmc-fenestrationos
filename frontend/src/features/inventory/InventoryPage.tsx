import { Boxes, MinusCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import type { InventoryItem } from '../../api/types';
import { fmtDateTime, fmtMm } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { canWrite, useApp, useBackend } from '../../store/app';
import type { InventoryInput } from '../../services/backend';
import { toast } from '../../store/toast';
import { Chip } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Segmented, Toggle } from '../../ui/Field';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Tabs } from '../../ui/Misc';

export default function InventoryPage() {
  const be = useBackend();
  const user = useApp((s) => s.user);
  const [kind, setKind] = useState<'bar' | 'sheet' | 'item'>('bar');
  const [res, setRes] = useState<'all' | 'stock' | 'residual'>('all');
  const [status, setStatus] = useState<'available' | 'all'>('available');
  const { data, loading, error, reload } = useAsync(() => be.listInventory({ kind, residual: res === 'all' ? undefined : res === 'residual', status: status === 'all' ? undefined : status }), [be, kind, res, status]);
  const [consume, setConsume] = useState<InventoryItem | null>(null);
  const [qty, setQty] = useState(1);
  const [add, setAdd] = useState(false);
  const eng = canWrite(user, 'engineering');

  const doConsume = async () => {
    if (!consume) return;
    try {
      const it = await be.consumeInventory(consume.id, qty);
      toast.success('Inventory consumed', `${qty} × item #${it.id} · ${it.quantity} left`);
      setConsume(null);
      reload();
    } catch (e) {
      toast.error('Consume failed', errorMessage(e));
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="inventory-page">
      <PageHeader
        title="Inventory"
        subtitle="Stock bars, sheets and counted items, plus reusable offcuts/residuals returned from optimisation jobs"
        actions={
          <Button variant="solid" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdd(true)} disabled={!eng || kind === 'item'} tip={kind === 'item' ? 'Items are booked by receiving purchase orders' : undefined}>
            Add stock
          </Button>
        }
      >
        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          <Tabs value={kind} onChange={setKind} tabs={[{ value: 'bar', label: 'Profile bars' }, { value: 'sheet', label: 'Sheets' }, { value: 'item', label: 'Items (pcs · m · m²)' }]} className="border-b-0" />
          <div className="mb-1 flex items-center gap-2">
            <Segmented value={res} onChange={setRes} options={[{ value: 'all', label: 'All' }, { value: 'stock', label: 'New stock' }, { value: 'residual', label: 'Residuals only' }]} testId="residual-filter" />
            <Segmented value={status} onChange={setStatus} options={[{ value: 'available', label: 'Available' }, { value: 'all', label: 'Incl. consumed' }]} />
          </div>
        </div>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !data?.length ? (
          <EmptyState icon={<Boxes className="h-5 w-5" />} title="No inventory items" detail="Add stock manually or return offcuts/residuals from a saved cutting or nesting job." />
        ) : (
          <table className="dense" data-testid="inventory-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Material</th>
                <th className="num">{kind === 'bar' ? 'Length' : kind === 'sheet' ? 'W × H' : 'Unit'}</th>
                {kind === 'sheet' && <th className="num">Thk</th>}
                <th className="num">Qty</th>
                <th>Type</th>
                <th>Source</th>
                <th>Location</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((it) => (
                <tr key={it.id}>
                  <td className="font-mono text-xs text-faint">INV-{it.id}</td>
                  <td className="font-mono text-xs">{it.material ?? it.profile_code ?? '—'}</td>
                  <td className="num">{kind === 'bar' ? fmtMm(it.length ?? 0) : kind === 'sheet' ? `${fmtMm(it.width ?? 0)} × ${fmtMm(it.height ?? 0)}` : it.unit === 'm2' ? 'm²' : (it.unit ?? '—')}</td>
                  {kind === 'sheet' && <td className="num">{it.thickness ?? '—'}</td>}
                  <td className="num">{it.quantity}</td>
                  <td>{it.is_residual ? <Chip tone="ok">residual</Chip> : <Chip>stock</Chip>}</td>
                  <td className="text-xs text-muted">{it.source_kind ? `${it.source_kind}${it.source_job_id ? ` #${it.source_job_id}` : ''}` : '—'}</td>
                  <td className="text-muted">{it.location ?? '—'}</td>
                  <td>{it.status === 'available' ? <Chip tone="accent">available</Chip> : <Chip>{it.status}</Chip>}</td>
                  <td className="font-mono text-xs text-muted">{fmtDateTime(it.created_at)}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" icon={<MinusCircle className="h-3.5 w-3.5" />} disabled={!eng || it.status !== 'available' || it.quantity <= 0} onClick={() => { setConsume(it); setQty(1); }}>
                      Consume
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Dialog
        open={!!consume}
        onClose={() => setConsume(null)}
        title={`Consume INV-${consume?.id}`}
        subtitle={`${consume?.quantity} available`}
        footer={
          <>
            <Button onClick={() => setConsume(null)}>Cancel</Button>
            <Button variant="solid" onClick={() => void doConsume()}>
              Consume
            </Button>
          </>
        }
      >
        <Field label="Quantity">
          <input className="input input-num w-32" type="number" min={1} max={consume?.quantity} value={qty} onChange={(e) => setQty(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
        </Field>
      </Dialog>
      {kind !== 'item' && <AddDialog open={add} kind={kind} onClose={() => setAdd(false)} onSaved={reload} />}
    </div>
  );
}

function AddDialog({ open, kind, onClose, onSaved }: { open: boolean; kind: 'bar' | 'sheet'; onClose: () => void; onSaved: () => void }) {
  const be = useBackend();
  const [f, setF] = useState<InventoryInput>({ kind, quantity: 1, is_residual: false, length: 6000, width: 3210, height: 2250 });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const body: InventoryInput = { ...f, kind, length: kind === 'bar' ? f.length : null, width: kind === 'sheet' ? f.width : null, height: kind === 'sheet' ? f.height : null, profile_code: kind === 'bar' ? f.material : null };
      await be.createInventory(body);
      toast.success('Inventory item added');
      onSaved();
      onClose();
    } catch (e) {
      toast.error('Could not add item', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Add ${kind === 'bar' ? 'profile bars' : 'sheets'}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid" loading={busy} onClick={() => void submit()}>
            Add
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={kind === 'bar' ? 'Profile code' : 'Material'} className="col-span-2">
          <input className="input font-mono" value={f.material ?? ''} onChange={(e) => setF({ ...f, material: e.target.value })} />
        </Field>
        {kind === 'bar' ? (
          <Field label="Length (mm)">
            <input className="input input-num" type="number" value={f.length ?? 0} onChange={(e) => setF({ ...f, length: Number(e.target.value) })} />
          </Field>
        ) : (
          <>
            <Field label="Width (mm)">
              <input className="input input-num" type="number" value={f.width ?? 0} onChange={(e) => setF({ ...f, width: Number(e.target.value) })} />
            </Field>
            <Field label="Height (mm)">
              <input className="input input-num" type="number" value={f.height ?? 0} onChange={(e) => setF({ ...f, height: Number(e.target.value) })} />
            </Field>
          </>
        )}
        <Field label="Quantity">
          <input className="input input-num" type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Math.max(0, Math.round(Number(e.target.value))) })} />
        </Field>
        <Field label="Location">
          <input className="input" value={f.location ?? ''} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <div className="col-span-2">
          <Toggle checked={f.is_residual} onChange={(v) => setF({ ...f, is_residual: v })} label="Residual / offcut (used first by optimisers)" />
        </div>
      </div>
    </Dialog>
  );
}
