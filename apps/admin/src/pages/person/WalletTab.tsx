import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PersonWallet, WalletTx } from '@manassah/shared';
import { api, money, when } from '../../api';
import { Badge, Drawer, Field, Kpi, DataTable, PersonLink, STATUS_TONE, ar, useToast, errMsg, can, type Column } from '../../ui';
import type { TabProps } from './types';

/** مرجع الحركة: طلب → بحث الطلبات برقمه (من الملاحظة) وإلا تبويب طلبات الشخص؛ admin → منفّذ التعديل */
function Ref({ t, id }: { t: WalletTx; id: number }) {
  if (t.refType === 'order' && t.refId) { const num = t.note?.match(/ORD-[\w-]+/)?.[0]; return <Link to={num ? `/orders?q=${num}` : `/users/${id}/orders`}>{num ?? `طلب #${t.refId}`}</Link>; }
  if (t.refType === 'admin' && t.refId) return <span className="small">بواسطة <PersonLink id={t.refId} /></span>;
  return <span className="muted">{t.refType ? `${t.refType} #${t.refId ?? ''}` : '—'}</span>;
}

/** المحفظة: الرصيد، تعديل الرصيد (المالية/الإدارة، ±٥٠٠ بحدّ أقصى، بملاحظة) ودفتر الحركات */
export function WalletTab({ me, d, id }: TabProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: '', type: 'adjustment', note: '' });
  const w = useQuery({ queryKey: ['adm-wallet', id, page], queryFn: () => api.get<PersonWallet>(`/admin/users/${id}/wallet`, { page, limit: 20 }) });
  const adjust = useMutation({
    mutationFn: () => api.post<{ balance: number }>(`/admin/users/${id}/wallet/adjust`, { amount: Number(f.amount), type: f.type, note: f.note.trim() }),
    onSuccess: r => { toast(`تم — الرصيد الآن ${money(r.balance)}`); setOpen(false); setF({ amount: '', type: 'adjustment', note: '' }); qc.invalidateQueries({ queryKey: ['adm-wallet', id] }); qc.invalidateQueries({ queryKey: ['adm-user', id] }); qc.invalidateQueries({ queryKey: ['adm-users'] }); }, onError: e => toast(errMsg(e)),
  });
  const amt = Number(f.amount);
  const ok = Number.isFinite(amt) && amt !== 0 && Math.abs(amt) <= 500 && f.note.trim().length >= 5;
  const canAdjust = can(me, 'finance') && d.status !== 'deleted';
  const cols: Column<WalletTx>[] = [
    { key: 'at', label: 'الوقت', className: 'num small', render: t => when(t.createdAt) },
    { key: 'type', label: 'النوع', render: t => <Badge tone={STATUS_TONE[t.type]}>{ar(t.type)}</Badge> },
    { key: 'amount', label: 'المبلغ', className: 'num', render: t => <span className={`amount ${t.amount >= 0 ? 'pos' : 'neg'}`}>{t.amount >= 0 ? '+' : '−'}{money(Math.abs(t.amount))}</span> },
    { key: 'after', label: 'الرصيد بعدها', className: 'num', render: t => money(t.balanceAfter) },
    { key: 'ref', label: 'المرجع', render: t => <Ref t={t} id={id} /> },
    { key: 'note', label: 'الملاحظة', className: 'small', render: t => t.note ?? '—' },
  ];
  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="kpis" style={{ marginBottom: 0, minWidth: 220 }}><Kpi label={`الرصيد (${w.data?.currency ?? d.wallet.currency})`} value={money(w.data?.balance ?? d.wallet.balance)} /></div>
        {canAdjust ? <button className="btn" onClick={() => setOpen(true)}>تعديل الرصيد</button> : <span className="muted small">تعديل الرصيد للمالية والإدارة فقط</span>}
      </div>
      <div className="card"><DataTable columns={cols} rows={w.data?.data} error={w.error} meta={w.data?.meta} onPage={setPage} loading={w.isLoading} empty="لا حركات بعد" /></div>
      {open ? (
        <Drawer title="تعديل رصيد المحفظة" onClose={() => setOpen(false)} footer={<><button className="btn secondary" onClick={() => setOpen(false)}>إلغاء</button><button className="btn" disabled={!ok || adjust.isPending} onClick={() => adjust.mutate()}>تطبيق</button></>}>
          <p className="muted small">يُقيَّد فوراً ويُبلَّغ المستخدم ويُسجَّل باسمك. الحدّ ±٥٠٠ ر.ع لكل عملية؛ الخصم لا يتجاوز الرصيد.</p>
          <Field label="المبلغ (سالب للخصم)"><input value={f.amount} inputMode="decimal" className="mono" placeholder="مثال 10 أو -5" onChange={e => setF(s => ({ ...s, amount: e.target.value }))} autoFocus /></Field>
          <Field label="النوع"><select value={f.type} onChange={e => setF(s => ({ ...s, type: e.target.value }))}><option value="adjustment">تعديل</option><option value="bonus">مكافأة</option></select></Field>
          <Field label="الملاحظة (٥ أحرف على الأقل — تصل للمستخدم)"><textarea value={f.note} onChange={e => setF(s => ({ ...s, note: e.target.value }))} /></Field>
          <div className="muted small">الرصيد الحالي {money(w.data?.balance ?? d.wallet.balance)} → {Number.isFinite(amt) ? money((w.data?.balance ?? d.wallet.balance) + amt) : '—'}</div>
        </Drawer>
      ) : null}
    </>
  );
}
