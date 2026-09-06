import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminUserRow, PageMeta } from '@manassah/shared';
import { api, money, when, day } from '../api';
import { Page, Badge, DataTable, PersonLink, ROLES, ar, useToast, errMsg, useConfirm, useDebounced, can, STATUS_TONE, type Me, type Column } from '../ui';

/** المستخدمون: بحث ومرشّحات (الحالة/الدور/الترتيب) وترقيم — الأدوار والمحفظة والمنح في صفحة الشخص.
 * يقرأ ?role= و ?status= من الرابط (روابط النظرة العامة) ويُعاد بناؤه عند تغيّرهما كما في الحجوزات/السحوبات */
export default function Users({ me }: { me: Me }) {
  const [sp] = useSearchParams();
  const role = sp.get('role') ?? '', status = sp.get('status') ?? '';
  return <UsersTable key={`${role}|${status}`} me={me} initialRole={role} initialStatus={status} />;
}

function UsersTable({ me, initialRole, initialStatus }: { me: Me; initialRole: string; initialStatus: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [role, setRole] = useState(initialRole);
  const [sort, setSort] = useState('created_desc');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['adm-users', dq, status, role, sort, page], queryFn: () => api.get<{ data: AdminUserRow[]; meta: PageMeta }>('/admin/users', { q: dq || undefined, status: status || undefined, role: role || undefined, sort, page, limit: 30 }) });
  const setStatusM = useMutation({ mutationFn: ({ id, status, reason }: { id: number; status: string; reason?: string }) => api.post(`/admin/users/${id}/status`, { status, reason }), onSuccess: () => { toast('تم'); qc.invalidateQueries({ queryKey: ['adm-users'] }); }, onError: e => toast(errMsg(e)) });
  const suspend = async (u: AdminUserRow) => { const r = await confirm({ title: `إيقاف ${u.name || `#${u.id}`}`, body: 'تُنهى جلساته فوراً ويُمنع من الدخول حتى التفعيل. السبب يُسجَّل ويظهر في صفحة الشخص.', reasonRequired: true, danger: true, confirmLabel: 'إيقاف' }); if (r) setStatusM.mutate({ id: u.id, status: 'suspended', reason: r.reason }); };
  const activate = async (u: AdminUserRow) => { const r = await confirm({ title: `تفعيل ${u.name || `#${u.id}`}`, body: 'يعود الحساب نشطاً ويُمسح سبب الإيقاف.', confirmLabel: 'تفعيل' }); if (r) setStatusM.mutate({ id: u.id, status: 'active' }); };
  const reset = (f: () => void) => { f(); setPage(1); };
  const cols: Column<AdminUserRow>[] = [
    { key: 'id', label: '#', className: 'num', render: u => u.id },
    { key: 'name', label: 'الاسم', render: u => <b><PersonLink id={u.id} name={u.name} /></b> },
    { key: 'contact', label: 'التواصل', className: 'num small', render: u => <>{u.phone ?? ''} {u.email ?? ''}</> },
    { key: 'roles', label: 'الأدوار', render: u => <span className="chips">{u.roles.map(r => <Badge key={r} tone={['admin', 'super_admin'].includes(r) ? 'brand' : r === 'teacher' ? 'gold' : ['support', 'finance', 'content_reviewer'].includes(r) ? 'info' : ''}>{ar(r)}</Badge>)}</span> },
    { key: 'learners', label: 'المتعلّمون', className: 'num', render: u => u.learnersCount },
    { key: 'wallet', label: 'المحفظة', className: 'num', render: u => money(u.walletBalance) },
    { key: 'status', label: 'الحالة', render: u => <Badge tone={STATUS_TONE[u.status]}>{ar(u.status)}</Badge> },
    { key: 'created', label: 'أُنشئ', className: 'num small', render: u => day(u.createdAt) },
    { key: 'login', label: 'آخر دخول', className: 'num small', render: u => when(u.lastLoginAt) },
    { key: 'act', label: '', className: 'actions', hide: !can(me, 'admin'), render: u => u.id !== me.id && u.status !== 'deleted' ? (u.status === 'active' ? <button className="btn danger sm" onClick={() => suspend(u)}>إيقاف</button> : <button className="btn success sm" onClick={() => activate(u)}>تفعيل</button>) : null },
  ];
  return (
    <Page title="المستخدمون" sub="الاسم يفتح صفحة الشخص: الأدوار والمحفظة والمتعلّمون والطلبات والجلسات">
      <div className="toolbar">
        <input placeholder="الاسم أو الهاتف أو البريد أو الرقم" value={q} onChange={e => reset(() => setQ(e.target.value))} />
        <select value={status} onChange={e => reset(() => setStatus(e.target.value))}><option value="">كل الحالات</option>{['active', 'suspended', 'deleted'].map(s => <option key={s} value={s}>{ar(s)}</option>)}</select>
        <select value={role} onChange={e => reset(() => setRole(e.target.value))}><option value="">كل الأدوار</option>{ROLES.map(r => <option key={r} value={r}>{ar(r)}</option>)}</select>
        <select value={sort} onChange={e => reset(() => setSort(e.target.value))}><option value="created_desc">الأحدث تسجيلاً</option><option value="last_login_desc">آخر دخول</option><option value="name">الاسم</option></select>
        <span className="muted small">{list.data?.meta.total ?? 0} مستخدم</span>
      </div>
      <div className="card"><DataTable columns={cols} rows={list.data?.data} meta={list.data?.meta} onPage={setPage} loading={list.isLoading} empty="لا نتائج" /></div>
    </Page>
  );
}
