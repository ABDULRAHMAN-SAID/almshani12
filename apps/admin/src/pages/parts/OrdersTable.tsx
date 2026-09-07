import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminOrder, PageMeta } from '@manassah/shared';
import { api, money, when } from '../../api';
import { Badge, Modal, Field, DataTable, PersonLink, LearnerChip, STATUS_TONE, ar, useToast, errMsg, useConfirm, can, type Me, type Column } from '../../ui';

export const ORDER_STATUSES = ['pending', 'paid', 'refunded', 'partially_refunded', 'failed', 'expired', 'cancelled'];

/** جدول الطلبات المشترك: تأكيد التحويل والاسترجاع للمالية، والصفّ يتوسّع لعرض العناصر والمدفوعات والاسترجاعات */
export function OrdersTable({ me, params = {}, initialStatus = '', initialQ = '', search, hideCustomer }: { me: Me; params?: Record<string, unknown>; initialStatus?: string; initialQ?: string; search?: boolean; hideCustomer?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(initialStatus);
  const [q, setQ] = useState(initialQ);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<AdminOrder | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const list = useQuery({ queryKey: ['adm-orders', params, status, q, page], queryFn: () => api.get<{ data: AdminOrder[]; meta: PageMeta }>('/admin/orders', { ...params, status: status || undefined, q: q || undefined, page, limit: 20 }) });
  // الاسترجاع يسحب الوصول ويقيّد في المحفظة — تبويبا «الاستحقاقات» و«المحفظة» لصاحب الطلب يجب ألّا يبقيا قديمين ١٥ ثانية
  const inv = (userId?: number) => {
    for (const k of ['adm-orders', 'adm-refunds', 'overview', 'adm-user']) qc.invalidateQueries({ queryKey: [k] });
    if (userId) { qc.invalidateQueries({ queryKey: ['adm-entitlements', userId] }); qc.invalidateQueries({ queryKey: ['adm-wallet', userId] }); qc.invalidateQueries({ queryKey: ['adm-user', userId] }); }
  };
  const confirmManual = useMutation({ mutationFn: ({ id, reference }: { id: number; reference: string; userId: number }) => api.post(`/admin/orders/${id}/confirm-manual`, { reference }), onSuccess: (_r, v) => { toast('تم التأكيد وتفعيل المحتوى'); inv(v.userId); }, onError: e => toast(errMsg(e)) });
  const refund = useMutation({ mutationFn: () => api.post(`/admin/orders/${sel!.id}/refund`, { amount: amount ? Number(amount) : undefined, reason }), onSuccess: () => { toast('تم الاسترجاع إلى محفظة الطالب'); inv(sel?.userId); setSel(null); }, onError: e => toast(errMsg(e)) });
  const fin = can(me, 'finance');
  const askManual = async (o: AdminOrder) => { const r = await confirm({ title: `تأكيد التحويل البنكي لطلب ${o.number}`, body: `${money(o.total)} — يُفعَّل المحتوى فوراً بعد التأكيد.`, fields: [{ key: 'reference', label: 'مرجع التحويل (اختياري)' }], confirmLabel: 'تأكيد التحويل' }); if (r) confirmManual.mutate({ id: o.id, reference: r.reference ?? '', userId: o.userId }); };
  const cols: Column<AdminOrder>[] = [
    { key: 'number', label: 'الرقم', className: 'num', render: o => <b>{o.number}</b> },
    { key: 'user', label: 'العميل', hide: hideCustomer, render: o => <PersonLink id={o.userId} name={o.userName} /> },
    { key: 'learner', label: 'المتعلّم', render: o => <LearnerChip learner={o.learner} /> },
    { key: 'items', label: 'العناصر', className: 'small', render: o => o.items.map(i => i.title).join('، ') },
    { key: 'total', label: 'الإجمالي', className: 'num', render: o => <>{money(o.total)}{o.discount > 0 ? <div className="muted small">خصم {money(o.discount)}</div> : null}</> },
    { key: 'provider', label: 'الوسيلة', render: o => <>{o.provider ? ar(o.provider) : '—'}{o.providerRef ? <div className="muted small num">{o.providerRef}</div> : null}</> },
    { key: 'status', label: 'الحالة', render: o => <Badge tone={STATUS_TONE[o.status]}>{ar(o.status)}</Badge> },
    { key: 'at', label: 'التاريخ', className: 'num small', render: o => when(o.createdAt) },
    { key: 'act', label: '', className: 'actions', hide: !fin, render: o => <>{o.provider === 'manual' && o.status === 'pending' ? <button className="btn success sm" disabled={confirmManual.isPending} onClick={() => askManual(o)}>تأكيد التحويل</button> : null} {['paid', 'partially_refunded'].includes(o.status) ? <button className="btn secondary sm" onClick={() => { setSel(o); setAmount(''); setReason(''); }}>استرجاع</button> : null}</> },
  ];
  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">كل الحالات</option>{ORDER_STATUSES.map(s => <option key={s} value={s}>{ar(s)}</option>)}</select>
        {search ? <input placeholder="رقم الطلب أو اسم العميل" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /> : null}
        <span className="muted small">{list.data?.meta.total ?? 0} طلب</span>
      </div>
      <div className="card">
        <DataTable columns={cols} rows={list.data?.data} meta={list.data?.meta} onPage={setPage} loading={list.isLoading} error={list.error} empty="لا طلبات" expand={o => (
          <div className="grid grid-3 small">
            <div><h3>العناصر</h3>{o.items.map((i, k) => <div key={k} className="row between"><span><Badge>{ar(i.itemType)}</Badge> {i.title}</span><span className="num">{i.quantity > 1 ? `${i.quantity} × ` : ''}{money(i.unitPrice)}</span></div>)}<div className="muted" style={{ marginTop: 6 }}>المتعلّم: <LearnerChip learner={o.learner} /> · مدفوع في <span className="num">{when(o.paidAt)}</span></div></div>
            <div><h3>المدفوعات</h3>{o.payments.length ? o.payments.map((p, k) => <div key={k} className="row between"><span>{ar(p.provider)} <Badge tone={STATUS_TONE[p.status]}>{ar(p.status)}</Badge></span><span className="num">{money(p.amount)} · {when(p.createdAt)}</span></div>) : <span className="muted">—</span>}</div>
            <div><h3>الاسترجاعات</h3>{o.refunds.length ? o.refunds.map((r, k) => <div key={k} className="row between"><span>{r.reason ?? '—'}</span><span className="num">{money(r.amount)} · {when(r.createdAt)}</span></div>) : <span className="muted">—</span>}</div>
          </div>
        )} />
      </div>
      {sel ? (
        <Modal title={`استرجاع ${sel.number}`} onClose={() => setSel(null)} footer={<button className="btn danger" disabled={refund.isPending || reason.trim().length < 3} onClick={() => refund.mutate()}>تنفيذ الاسترجاع</button>}>
          <p className="muted small">يُقيَّد المبلغ في محفظة الطالب فوراً. الاسترجاع الكامل يسحب الوصول للمحتوى ويعكس ربح المعلّم.</p>
          <Field label={`المبلغ (فارغ = كامل ${money(sel.total)})`}><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></Field>
          <Field label="السبب"><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </Modal>
      ) : null}
    </>
  );
}
