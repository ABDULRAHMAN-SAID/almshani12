import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, money, when } from '../api';
import { Page, Badge, Modal, Field, Empty, STATUS_TONE, ar, useToast, errMsg, can, type Me } from '../ui';

/** الطلبات: تأكيد التحويلات البنكية، الاسترجاع الكامل/الجزئي (يُعكس الربح ويُسحب الوصول تلقائياً) */
export default function Orders({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'orders' | 'refunds'>('orders');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<any | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const list = useQuery({ queryKey: ['adm-orders', status, q], queryFn: () => api.get<{ data: any[]; meta: any }>('/admin/orders', { status: status || undefined, q: q || undefined, limit: 60 }) });
  const refunds = useQuery({ queryKey: ['adm-refunds'], queryFn: () => api.get<any[]>('/admin/refunds'), enabled: tab === 'refunds' });
  const confirmManual = useMutation({ mutationFn: (id: number) => api.post(`/admin/orders/${id}/confirm-manual`, { reference: prompt('مرجع التحويل (اختياري)') ?? '' }), onSuccess: () => { toast('تم التأكيد وتفعيل المحتوى'); qc.invalidateQueries({ queryKey: ['adm-orders'] }); qc.invalidateQueries({ queryKey: ['overview'] }); }, onError: e => toast(errMsg(e)) });
  const refund = useMutation({ mutationFn: () => api.post(`/admin/orders/${sel.id}/refund`, { amount: amount ? Number(amount) : undefined, reason }), onSuccess: () => { toast('تم الاسترجاع إلى محفظة الطالب'); setSel(null); qc.invalidateQueries({ queryKey: ['adm-orders'] }); qc.invalidateQueries({ queryKey: ['adm-refunds'] }); }, onError: e => toast(errMsg(e)) });
  const fin = can(me, 'finance');
  return (
    <Page title="الطلبات والاسترجاع">
      <div className="tabs"><button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>الطلبات</button><button className={tab === 'refunds' ? 'on' : ''} onClick={() => setTab('refunds')}>سجلّ الاسترجاع</button></div>
      {tab === 'orders' ? (<>
        <div className="toolbar">
          <select value={status} onChange={e => setStatus(e.target.value)}><option value="">كل الحالات</option>{['pending', 'paid', 'refunded', 'partially_refunded', 'failed', 'expired', 'cancelled'].map(s => <option key={s} value={s}>{ar(s)}</option>)}</select>
          <input placeholder="رقم الطلب أو اسم العميل" value={q} onChange={e => setQ(e.target.value)} /><span className="muted small">{list.data?.meta.total ?? 0} طلب</span>
        </div>
        <div className="card tbl">{list.data?.data.length ? (
          <table><thead><tr><th>الرقم</th><th>العميل</th><th>العناصر</th><th>الإجمالي</th><th>الوسيلة</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead>
            <tbody>{list.data.data.map(o => <tr key={o.id}><td className="num"><b>{o.number}</b></td><td>{o.userName}</td><td className="small">{o.items.map((i: any) => i.title).join('، ')}</td><td className="num">{money(o.total)}{o.discount > 0 ? <div className="muted small">خصم {money(o.discount)}</div> : null}</td><td>{o.provider ?? '—'}{o.providerRef ? <div className="muted small num">{o.providerRef}</div> : null}</td><td><Badge tone={STATUS_TONE[o.status]}>{ar(o.status)}</Badge></td><td className="num small">{when(o.createdAt)}</td>
              <td className="actions">{fin && o.provider === 'manual' && o.status === 'pending' ? <button className="btn success sm" disabled={confirmManual.isPending} onClick={() => confirmManual.mutate(o.id)}>تأكيد التحويل</button> : null} {fin && ['paid', 'partially_refunded'].includes(o.status) ? <button className="btn secondary sm" onClick={() => { setSel(o); setAmount(''); setReason(''); }}>استرجاع</button> : null}</td></tr>)}</tbody></table>
        ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا طلبات'} />}</div>
      </>) : (
        <div className="card tbl">{refunds.data?.length ? (
          <table><thead><tr><th>الطلب</th><th>العميل</th><th>المبلغ</th><th>السبب</th><th>الحجز</th><th>التاريخ</th></tr></thead>
            <tbody>{refunds.data.map(r => <tr key={r.id}><td className="num">{r.number}</td><td>{r.display_name}</td><td className="num">{money(r.amount)}</td><td>{r.reason ?? '—'}</td><td className="num">{r.booking_id ?? '—'}</td><td className="num small">{when(r.processed_at ?? r.created_at)}</td></tr>)}</tbody></table>
        ) : <Empty text="لا استرجاعات" />}</div>
      )}
      {sel ? (
        <Modal title={`استرجاع ${sel.number}`} onClose={() => setSel(null)} footer={<button className="btn danger" disabled={refund.isPending || reason.trim().length < 3} onClick={() => refund.mutate()}>تنفيذ الاسترجاع</button>}>
          <p className="muted small">يُقيَّد المبلغ في محفظة الطالب فوراً. الاسترجاع الكامل يسحب الوصول للمحتوى ويعكس ربح المعلّم.</p>
          <Field label={`المبلغ (فارغ = كامل ${money(sel.total)})`}><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></Field>
          <Field label="السبب"><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </Modal>
      ) : null}
    </Page>
  );
}
