import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, money, when } from '../api';
import { Page, Badge, Empty, ar, useToast, errMsg } from '../ui';

/** سحوبات المعلّمين: موافقة → صرف (يربط الأرباح المتاحة بالصرف) أو رفض (يعيد الرصيد) */
export default function Payouts() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const list = useQuery({ queryKey: ['adm-payouts', status], queryFn: () => api.get<any[]>('/admin/payouts', { status }) });
  const decide = useMutation({ mutationFn: ({ id, decision, note }: { id: number; decision: string; note?: string }) => api.post(`/admin/payouts/${id}/decision`, { decision, note }), onSuccess: () => { toast('تم'); qc.invalidateQueries({ queryKey: ['adm-payouts'] }); qc.invalidateQueries({ queryKey: ['overview'] }); }, onError: e => toast(errMsg(e)) });
  return (
    <Page title="سحوبات المعلّمين">
      <div className="toolbar">{['pending', 'approved', 'paid', 'rejected'].map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{ar(s) === s ? { pending: 'قيد الانتظار', approved: 'موافَق', paid: 'مصروف', rejected: 'مرفوض' }[s] : ar(s)}</button>)}</div>
      <div className="card tbl">{list.data?.length ? (
        <table><thead><tr><th>المعلّم</th><th>المبلغ</th><th>الوسيلة</th><th>التفاصيل</th><th>طُلب في</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{list.data.map(p => <tr key={p.id}><td><b>{p.teacherName}</b></td><td className="num">{money(p.amount)}</td><td>{p.method === 'bank' ? 'تحويل بنكي' : 'محفظة'}</td><td className="small num">{Object.entries(p.details ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}{p.note ? <div className="muted">{p.note}</div> : null}</td><td className="num small">{when(p.requestedAt)}</td><td><Badge tone={p.status === 'paid' ? 'success' : p.status === 'rejected' ? 'danger' : 'warning'}>{p.status}</Badge></td>
            <td className="actions">{p.status === 'pending' ? <><button className="btn secondary sm" onClick={() => decide.mutate({ id: p.id, decision: 'approved' })}>موافقة</button> <button className="btn danger sm" onClick={() => { const note = prompt('سبب الرفض') ?? ''; decide.mutate({ id: p.id, decision: 'rejected', note }); }}>رفض</button></> : null} {['pending', 'approved'].includes(p.status) ? <button className="btn success sm" onClick={() => confirm(`تأكيد صرف ${money(p.amount)}؟`) && decide.mutate({ id: p.id, decision: 'paid' })}>تم الصرف</button> : null}</td></tr>)}</tbody></table>
      ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا طلبات'} />}</div>
    </Page>
  );
}
