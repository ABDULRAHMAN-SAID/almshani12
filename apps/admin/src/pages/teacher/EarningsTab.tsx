import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { TeacherAdminDetail, TeacherEarningsAdmin, TeacherEarningRow } from '@manassah/shared';
import { api, money, when } from '../../api';
import { Badge, Kpi, DataTable, STATUS_TONE, ar, type Column } from '../../ui';

const STATUSES = ['', 'pending', 'available', 'paid', 'reversed'];

/** الأرباح (للمالية): الإجماليات، دفتر الأرباح بمرشّح الحالة، وبطاقة وسيلة الصرف */
export function EarningsTab({ d }: { d: TeacherAdminDetail }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const e = useQuery({ queryKey: ['adm-teacher-earnings', d.id, status, page], queryFn: () => api.get<TeacherEarningsAdmin>(`/admin/teachers/${d.id}/earnings`, { status: status || undefined, page, limit: 20 }) });
  const ref = (r: TeacherEarningRow) => r.source === 'lesson' ? <Link to={`/teachers/${d.id}/bookings`}>حجز #{r.refId}</Link> : <Link to={`/orders`}>{ar(r.source)} #{r.refId}</Link>;
  const cols: Column<TeacherEarningRow>[] = [
    { key: 'at', label: 'التاريخ', className: 'num small', render: r => when(r.createdAt) },
    { key: 'src', label: 'المصدر', render: r => <><Badge>{ar(r.source)}</Badge> {ref(r)}</> },
    { key: 'gross', label: 'الإجمالي', className: 'num', render: r => money(r.gross) },
    { key: 'comm', label: 'العمولة', className: 'num', render: r => money(r.commission) },
    { key: 'net', label: 'الصافي', className: 'num', render: r => <b>{money(r.net)}</b> },
    { key: 'st', label: 'الحالة', render: r => <Badge tone={STATUS_TONE[r.status]}>{ar(r.status)}</Badge> },
    { key: 'avail', label: 'يتاح في', className: 'num small', render: r => when(r.availableAt) },
    { key: 'payout', label: 'الصرف', className: 'num small', render: r => r.payoutId ? <Link to={`/teachers/${d.id}/payouts`}>#{r.payoutId}</Link> : '—' },
  ];
  const t = e.data?.totals;
  return (
    <>
      <div className="kpis">
        <Kpi label="أرباح مدى الحياة" value={money(d.stats.earnings.lifetime)} /><Kpi label="متاح للسحب" value={money(d.stats.earnings.available)} tone="ok" /><Kpi label="معلّق (نافذة الاسترجاع)" value={money(d.stats.earnings.pending)} />
        <Kpi label="إجمالي (المرشَّح)" value={money(t?.gross ?? 0)} /><Kpi label="عمولة المنصّة" value={money(t?.commission ?? 0)} /><Kpi label="صافي" value={money(t?.net ?? 0)} />
      </div>
      <div>
        <div>
          <div className="toolbar">{STATUSES.map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => { setStatus(s); setPage(1); }}>{s ? ar(s) : 'الكل'}</button>)}</div>
          <div className="card"><DataTable columns={cols} rows={e.data?.data} meta={e.data?.meta} onPage={setPage} loading={e.isLoading} empty="لا أرباح" /></div>
        </div>
        <div className="card" style={{ marginTop: 16 }}><h2>وسيلة الصرف</h2>{d.payoutMethod ? <dl className="kv"><dt>الوسيلة</dt><dd>{d.payoutMethod === 'bank' ? 'تحويل بنكي' : d.payoutMethod}</dd>{Object.entries((d.payoutDetails as Record<string, unknown> | null) ?? {}).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd className="mono">{String(v)}</dd></div>)}</dl> : <p className="muted">لم يضبط المعلّم وسيلة صرف بعد.</p>}</div>
      </div>
    </>
  );
}
