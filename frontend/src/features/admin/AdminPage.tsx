import { ChevronLeft, ChevronRight, ShieldAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import type { Role, User } from '../../api/types';
import { fmtDateTime } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useApp, useBackend } from '../../store/app';
import { toast } from '../../store/toast';
import { Chip } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Select } from '../../ui/Field';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Tabs } from '../../ui/Misc';

const ROLES: Role[] = ['admin', 'engineer', 'estimator', 'viewer'];

export default function AdminPage() {
  const { mode, user } = useApp();
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  if (mode === 'offline')
    return (
      <div className="flex h-full flex-col" data-testid="admin-page">
        <PageHeader title="Admin / Audit" />
        <EmptyState
          icon={<ShieldAlert className="h-5 w-5" />}
          title="Server mode only"
          detail="User administration and the audit trail are recorded and enforced by the FenestrationOS server (every write — logins, edits, calculations, optimisations, catalogue changes — is audited). Offline demo mode has a single local admin user and keeps no audit trail."
        />
      </div>
    );
  if (user?.role !== 'admin')
    return (
      <div className="flex h-full flex-col" data-testid="admin-page">
        <PageHeader title="Admin / Audit" />
        <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Admins only" detail={`Your role is “${user?.role}”.`} />
      </div>
    );
  return (
    <div className="flex h-full flex-col" data-testid="admin-page">
      <PageHeader title="Admin / Audit">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Users' }, { value: 'audit', label: 'Audit trail' }]} className="mt-2 border-b-0" />
      </PageHeader>
      {tab === 'users' ? <Users /> : <Audit />}
    </div>
  );
}

function Users() {
  const be = useBackend();
  const me = useApp((s) => s.user);
  const { data, loading, error, reload } = useAsync(() => be.listUsers(), [be]);
  const [dlg, setDlg] = useState(false);
  const [f, setF] = useState({ email: '', name: '', role: 'viewer' as Role, password: '' });
  const [busy, setBusy] = useState(false);
  const update = async (u: User, p: { role?: Role; active?: boolean }) => {
    try {
      await be.updateUser(u.id, p);
      toast.success('User updated', u.email);
      reload();
    } catch (e) {
      toast.error('Update failed', errorMessage(e));
    }
  };
  const create = async () => {
    if (f.password.length < 8) return toast.error('Password must have at least 8 characters');
    setBusy(true);
    try {
      await be.createUser(f);
      toast.success('User created', f.email);
      setDlg(false);
      setF({ email: '', name: '', role: 'viewer', password: '' });
      reload();
    } catch (e) {
      toast.error('Could not create user', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center px-4 py-2">
        <div className="flex-1 text-xs text-muted">Roles: admin · engineer · estimator · viewer. The last active admin cannot be demoted.</div>
        <Button variant="solid" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setDlg(true)}>
          New user
        </Button>
      </div>
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : (
        <table className="dense">
          <thead>
            <tr>
              <th>E-mail</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id}>
                <td className="font-mono text-xs">{u.email}</td>
                <td>{u.name}</td>
                <td className="w-[150px]">
                  <Select value={u.role} onChange={(r) => void update(u, { role: r })} options={ROLES.map((r) => ({ value: r, label: r }))} className="h-6" />
                </td>
                <td>{u.active ? <Chip tone="ok">active</Chip> : <Chip>inactive</Chip>}</td>
                <td className="font-mono text-xs text-muted">{fmtDateTime(u.last_login_at)}</td>
                <td className="text-right">
                  <Button size="sm" variant={u.active ? 'danger' : 'default'} disabled={u.id === me?.id} tip={u.id === me?.id ? 'You cannot deactivate yourself' : undefined} onClick={() => void update(u, { active: !u.active })}>
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Dialog
        open={dlg}
        onClose={() => setDlg(false)}
        title="New user"
        footer={
          <>
            <Button onClick={() => setDlg(false)}>Cancel</Button>
            <Button variant="solid" loading={busy} onClick={() => void create()}>
              Create
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="E-mail" className="col-span-2">
            <input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Name">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={f.role} onChange={(r) => setF({ ...f, role: r })} options={ROLES.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="Initial password" hint="8–72 characters" className="col-span-2">
            <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function Audit() {
  const be = useBackend();
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const { data, loading, error, reload } = useAsync(() => be.listAudit({ action: action || undefined, entity: entity || undefined, limit, offset }), [be, action, entity, offset]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 py-2">
        <input className="input w-[180px]" placeholder="action (e.g. update)" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} />
        <input className="input w-[180px]" placeholder="entity (e.g. elevation)" value={entity} onChange={(e) => { setEntity(e.target.value); setOffset(0); }} />
        <div className="flex-1" />
        <span className="font-mono text-2xs text-faint">
          {data ? `${offset + 1}–${Math.min(offset + limit, data.total)} of ${data.total}` : ''}
        </span>
        <Button size="sm" iconOnly icon={<ChevronLeft className="h-3.5 w-3.5" />} tip="Previous" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} />
        <Button size="sm" iconOnly icon={<ChevronRight className="h-3.5 w-3.5" />} tip="Next" disabled={!data || offset + limit >= data.total} onClick={() => setOffset(offset + limit)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <EmptyState title="No audit entries" />
        ) : (
          <table className="dense" data-testid="audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono text-xs text-muted">{fmtDateTime(a.ts)}</td>
                  <td className="font-mono text-xs">{a.user_email ?? '—'}</td>
                  <td>
                    <Chip tone={a.action.includes('fail') || a.action.includes('blocked') ? 'err' : 'neutral'}>{a.action}</Chip>
                  </td>
                  <td className="font-mono text-xs">
                    {a.entity}
                    {a.entity_id ? ` #${a.entity_id}` : ''}
                  </td>
                  <td className="max-w-[520px] truncate font-mono text-2xs text-faint" title={JSON.stringify(a.detail)}>
                    {a.detail ? JSON.stringify(a.detail) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
