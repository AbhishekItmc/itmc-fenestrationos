import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import type { Customer, CustomerInput, Project, ProjectInput, ProjectStatus } from '../../api/types';
import { PROJECT_STATUSES } from '../../api/types';
import { useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Select } from '../../ui/Field';

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function CustomerDialog({ open, onClose, customer, onSaved }: { open: boolean; onClose: () => void; customer?: Customer | null; onSaved: (c: Customer) => void }) {
  const be = useBackend();
  const [f, setF] = useState<CustomerInput>({ name: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF(customer ? { name: customer.name, contact_name: customer.contact_name, email: customer.email, phone: customer.phone, address: customer.address, notes: customer.notes } : { name: '' });
      setErr(null);
    }
  }, [open, customer]);
  const set = (p: Partial<CustomerInput>) => setF({ ...f, ...p });
  const submit = async () => {
    if (!f.name.trim()) return setErr('Name is required');
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(f.email)) return setErr('E-mail address is not valid');
    setBusy(true);
    setErr(null);
    try {
      const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v])) as CustomerInput;
      const c = customer ? await be.updateCustomer(customer.id, clean) : await be.createCustomer(clean);
      toast.success(customer ? 'Customer updated' : 'Customer created', c.name);
      onSaved(c);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={customer ? 'Edit customer' : 'New customer'}
      testId="customer-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid" loading={busy} onClick={() => void submit()} data-testid="customer-save">
            {customer ? 'Save' : 'Create customer'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company name" className="col-span-2">
          <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} data-testid="customer-name" autoFocus />
        </Field>
        <Field label="Contact person">
          <input className="input" value={f.contact_name ?? ''} onChange={(e) => set({ contact_name: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input className="input" value={f.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="E-mail" className="col-span-2">
          <input className="input" value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label="Address" className="col-span-2">
          <textarea className="input h-16 py-1.5" value={f.address ?? ''} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label="Notes" className="col-span-2">
          <textarea className="input h-14 py-1.5" value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>
      {err && <div className="mt-3 rounded border border-err/40 bg-err/10 px-2.5 py-1.5 text-sm text-err">{err}</div>}
    </Dialog>
  );
}

export function ProjectDialog({ open, onClose, project, onSaved }: { open: boolean; onClose: () => void; project?: Project | null; onSaved: (p: Project) => void }) {
  const be = useBackend();
  const [f, setF] = useState<ProjectInput>({ code: '', name: '', status: 'enquiry' });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [custDlg, setCustDlg] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(project ? { code: project.code, name: project.name, customer_id: project.customer_id ?? null, site: project.site, status: project.status, description: project.description } : { code: '', name: '', status: 'enquiry' });
    setErr(null);
    be.listCustomers()
      .then(setCustomers)
      .catch((e) => setErr(`Could not load customers: ${errorMessage(e)}`));
  }, [open, project, be]);
  const set = (p: Partial<ProjectInput>) => setF({ ...f, ...p });
  const submit = async () => {
    if (!f.code.trim() || !CODE_RE.test(f.code.trim())) return setErr('Code is required: letters, digits and . _ / - (must start with a letter or digit)');
    if (!f.name.trim()) return setErr('Name is required');
    setBusy(true);
    setErr(null);
    try {
      const body: ProjectInput = { ...f, code: f.code.trim(), name: f.name.trim(), site: f.site?.trim() || null, description: f.description?.trim() || null };
      const p = project ? await be.updateProject(project.id, body) : await be.createProject(body);
      toast.success(project ? 'Project updated' : 'Project created', `${p.code} · ${p.name}`);
      onSaved(p);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open={open && !custDlg}
        onClose={onClose}
        title={project ? `Edit project ${project.code}` : 'New project'}
        width={600}
        testId="project-dialog"
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="solid" loading={busy} onClick={() => void submit()} data-testid="project-save">
              {project ? 'Save changes' : 'Create project'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Code" hint="e.g. TWR-01">
            <input className="input font-mono" value={f.code} onChange={(e) => set({ code: e.target.value })} data-testid="project-code" autoFocus />
          </Field>
          <Field label="Name" className="col-span-2">
            <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} data-testid="project-name" />
          </Field>
          <Field label="Customer" className="col-span-2" group>
            <div className="flex gap-2">
              <Select value={f.customer_id ? String(f.customer_id) : ''} placeholder="— none —" options={customers.map((c) => ({ value: String(c.id), label: c.name }))} onChange={(v) => set({ customer_id: v ? Number(v) : null })} testId="project-customer" />
              <Button iconOnly icon={<Plus className="h-3.5 w-3.5" />} tip="New customer" onClick={() => setCustDlg(true)} />
            </div>
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={(v) => set({ status: v as ProjectStatus })} options={PROJECT_STATUSES.map((s) => ({ value: s, label: s }))} />
          </Field>
          <Field label="Site" className="col-span-3">
            <input className="input" value={f.site ?? ''} onChange={(e) => set({ site: e.target.value })} />
          </Field>
          <Field label="Description" className="col-span-3">
            <textarea className="input h-20 py-1.5" value={f.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>
        {err && <div className="mt-3 rounded border border-err/40 bg-err/10 px-2.5 py-1.5 text-sm text-err">{err}</div>}
      </Dialog>
      <CustomerDialog
        open={custDlg}
        onClose={() => setCustDlg(false)}
        onSaved={(c) => {
          setCustomers([...customers, c].sort((a, b) => a.name.localeCompare(b.name)));
          setF((cur) => ({ ...cur, customer_id: c.id }));
        }}
      />
    </>
  );
}
