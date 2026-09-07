import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, money, when } from '../../api';
import { Badge, DataTable, TeacherLink, useToast, errMsg, useConfirm, type Column } from '../../ui';

export type PayoutRow = { id: number; teacherId: number; teacherName: string; amount: number; method: string; details: Record<string, unknown>; status: string; note: string | null; requestedAt: string; processedAt: string | null };
const PAYOUT_AR: Record<string, string> = { pending: 'قيد الانتظار', approved: 'موافَق', paid: 'مصروف', rejected: 'مرفوض', all: 'الكل' };

/** سحوبات المعلّمين: موافقة → صرف (يربط الأرباح المتاحة بالصرف) أو رفض (يعيد الرصيد) — مشترك مع تبويب المعلّم */
export function PayoutsTable({ params = {}, initialStatus = 'pending', hideTeacher }: { params?: Record<string, unknown>; initialStatus?: string; hideTeacher?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(initialStatus);
  const list = useQuery({ queryKey: ['adm-payouts', params, status], queryFn: () => api.get<PayoutRow[]>('/admin/payouts', { ...params, status }) });
  const decide = useMutation({ mutationFn: ({ id, decision, note }: { id: number; decision: string; note?: string }) => api.post(`/admin/payouts/${id}/decision`, { decision, note }), onSuccess: () => { toast('تم'); qc.invalidateQueries({ queryKey: ['adm-payouts'] }); qc.invalidateQueries({ queryKey: ['overview'] }); qc.invalidateQueries({ queryKey: ['adm-teacher'] }); }, onError: e => toast(errMsg(e)) });
  const reject = async (p: PayoutRow) => { const r = await confirm({ title: `رفض طلب سحب ${money(p.amount)}`, body: 'يعود المبلغ إلى رصيد المعلّم المتاح.', reasonRequired: true, reasonLabel: 'سبب الرفض (يصل للمعلّم)', danger: true, confirmLabel: 'رفض' }); if (r) decide.mutate({ id: p.id, decision: 'rejected', note: r.reason }); };
  const approve = async (p: PayoutRow) => { const r = await confirm({ title: `الموافقة على سحب ${money(p.amount)}`, body: `${p.teacherName} — تُحجز الأرباح للصرف ولا يستطيع المعلّم سحبها مرّة أخرى.`, confirmLabel: 'موافقة' }); if (r) decide.mutate({ id: p.id, decision: 'approved' }); };
  const pay = async (p: PayoutRow) => { const r = await confirm({ title: `تأكيد صرف ${money(p.amount)}`, body: `${p.teacherName} — ${p.method === 'bank' ? 'تحويل بنكي' : 'محفظة'}. تُربط الأرباح المتاحة بهذا الصرف.`, confirmLabel: 'تم الصرف' }); if (r) decide.mutate({ id: p.id, decision: 'paid' }); };
  const cols: Column<PayoutRow>[] = [
    { key: 'teacher', label: 'المعلّم', hide: hideTeacher, render: p => <b><TeacherLink id={p.teacherId} name={p.teacherName} /></b> },
    { key: 'amount', label: 'المبلغ', className: 'num', render: p => money(p.amount) },
    { key: 'method', label: 'الوسيلة', render: p => p.method === 'bank' ? 'تحويل بنكي' : 'محفظة' },
    { key: 'details', label: 'التفاصيل', className: 'small num', render: p => <>{Object.entries(p.details ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}{p.note ? <div className="muted">{p.note}</div> : null}</> },
    { key: 'at', label: 'طُلب في', className: 'num small', render: p => when(p.requestedAt) },
    { key: 'status', label: 'الحالة', render: p => <Badge tone={p.status === 'paid' ? 'success' : p.status === 'rejected' ? 'danger' : p.status === 'approved' ? 'info' : 'warning'}>{PAYOUT_AR[p.status] ?? p.status}</Badge> },
    { key: 'act', label: '', className: 'actions', render: p => <>{p.status === 'pending' ? <><button className="btn secondary sm" disabled={decide.isPending} onClick={() => approve(p)}>موافقة</button> <button className="btn danger sm" disabled={decide.isPending} onClick={() => reject(p)}>رفض</button></> : null} {['pending', 'approved'].includes(p.status) ? <button className="btn success sm" disabled={decide.isPending} onClick={() => pay(p)}>تم الصرف</button> : null}</> },
  ];
  return (
    <>
      <div className="toolbar">{['pending', 'approved', 'paid', 'rejected', 'all'].map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{PAYOUT_AR[s]}</button>)}</div>
      <div className="card"><DataTable columns={cols} rows={list.data} loading={list.isLoading} error={list.error} empty="لا طلبات" /></div>
    </>
  );
}
