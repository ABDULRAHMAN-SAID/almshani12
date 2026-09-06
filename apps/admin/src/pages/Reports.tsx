import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, when } from '../api';
import { Page, Badge, Empty, STATUS_TONE, ar, useToast, errMsg } from '../ui';

/** البلاغات: مستخدم/رسالة/كتاب/دورة/تقييم — تُغلق بقرار، وإخفاء التقييم المسيء */
export default function Reports() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const list = useQuery({ queryKey: ['adm-reports', status], queryFn: () => api.get<any[]>('/admin/reports', { status }) });
  const setSt = useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/admin/reports/${id}/status`, { status }), onSuccess: () => { toast('تم'); qc.invalidateQueries({ queryKey: ['adm-reports'] }); qc.invalidateQueries({ queryKey: ['overview'] }); }, onError: e => toast(errMsg(e)) });
  const hide = useMutation({ mutationFn: (id: number) => api.post(`/admin/reviews/${id}/hide`), onSuccess: () => toast('أُخفي التقييم'), onError: e => toast(errMsg(e)) });
  return (
    <Page title="البلاغات">
      <div className="toolbar">{['open', 'reviewing', 'resolved', 'dismissed'].map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{ar(s)}</button>)}</div>
      <div className="card tbl">{list.data?.length ? (
        <table><thead><tr><th>#</th><th>المبلِّغ</th><th>الهدف</th><th>السبب</th><th>التاريخ</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{list.data.map(r => <tr key={r.id}><td className="num">{r.id}</td><td>{r.reporter}</td><td>{ar(r.target_type) === r.target_type ? r.target_type : ar(r.target_type)} #{r.target_id}</td><td>{r.reason}</td><td className="num small">{when(r.created_at)}</td><td><Badge tone={STATUS_TONE[r.status]}>{ar(r.status)}</Badge></td>
            <td className="actions">{r.status === 'open' ? <button className="btn secondary sm" onClick={() => setSt.mutate({ id: r.id, status: 'reviewing' })}>بدء المراجعة</button> : null} {['open', 'reviewing'].includes(r.status) ? <><button className="btn success sm" onClick={() => setSt.mutate({ id: r.id, status: 'resolved' })}>حُلّ</button> <button className="btn ghost sm" onClick={() => setSt.mutate({ id: r.id, status: 'dismissed' })}>رفض</button></> : null} {r.target_type === 'review' ? <button className="btn danger sm" onClick={() => hide.mutate(r.target_id)}>إخفاء التقييم</button> : null}</td></tr>)}</tbody></table>
      ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا بلاغات'} />}</div>
    </Page>
  );
}
