import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminReport } from '@manassah/shared';
import { api, when } from '../../api';
import { Badge, DataTable, PersonLink, STATUS_TONE, ar, useToast, errMsg, useConfirm, type Column } from '../../ui';

export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed', 'all'];

/** البلاغات: مستخدم/رسالة/كتاب/دورة/تقييم — تُغلق بقرار، وإخفاء التقييم المسيء بسبب مسجَّل */
export function ReportsTable({ params = {}, initialStatus = 'open', hideReporter, statusChips = true }: { params?: Record<string, unknown>; initialStatus?: string; hideReporter?: boolean; statusChips?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(initialStatus);
  const list = useQuery({ queryKey: ['adm-reports', params, status], queryFn: () => api.get<AdminReport[]>('/admin/reports', { ...params, status }) });
  const inv = () => { qc.invalidateQueries({ queryKey: ['adm-reports'] }); qc.invalidateQueries({ queryKey: ['overview'] }); };
  const setSt = useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/admin/reports/${id}/status`, { status }), onSuccess: () => { toast('تم'); inv(); }, onError: e => toast(errMsg(e)) });
  const hide = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => api.post(`/admin/reviews/${id}/hide`, { reason }), onSuccess: () => { toast('أُخفي التقييم'); inv(); }, onError: e => toast(errMsg(e)) });
  const askHide = async (r: AdminReport) => { const v = await confirm({ title: `إخفاء التقييم #${r.targetId}`, body: r.targetLabel || undefined, reasonRequired: true, danger: true, confirmLabel: 'إخفاء' }); if (v) hide.mutate({ id: r.targetId, reason: v.reason }); };
  const cols: Column<AdminReport>[] = [
    { key: 'id', label: '#', className: 'num', render: r => r.id },
    { key: 'reporter', label: 'المبلِّغ', hide: hideReporter, render: r => <PersonLink id={r.reporterId} name={r.reporter} /> },
    { key: 'target', label: 'الهدف', render: r => <><Badge>{ar(r.targetType)}</Badge> <span className="num">#{r.targetId}</span>{r.targetLabel ? <div className="small muted">{r.targetLabel}</div> : null}{r.targetOwnerId ? <div className="small">صاحبه: <PersonLink id={r.targetOwnerId} name={r.targetType === 'user' ? r.targetLabel : undefined} /></div> : null}</> },
    { key: 'reason', label: 'السبب', render: r => r.reason },
    { key: 'at', label: 'التاريخ', className: 'num small', render: r => when(r.createdAt) },
    { key: 'status', label: 'الحالة', render: r => <><Badge tone={STATUS_TONE[r.status]}>{ar(r.status)}</Badge>{r.handledBy ? <div className="small muted">تولّاه <PersonLink id={r.handledBy.id} name={r.handledBy.name} /></div> : null}</> },
    { key: 'act', label: '', className: 'actions', render: r => <>{r.status === 'open' ? <button className="btn secondary sm" onClick={() => setSt.mutate({ id: r.id, status: 'reviewing' })}>بدء المراجعة</button> : null} {['open', 'reviewing'].includes(r.status) ? <><button className="btn success sm" onClick={() => setSt.mutate({ id: r.id, status: 'resolved' })}>حُلّ</button> <button className="btn ghost sm" onClick={() => setSt.mutate({ id: r.id, status: 'dismissed' })}>رفض</button></> : null} {r.targetType === 'review' ? <button className="btn danger sm" onClick={() => askHide(r)}>إخفاء التقييم</button> : null}</> },
  ];
  return (
    <>
      {statusChips ? <div className="toolbar">{REPORT_STATUSES.map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s === 'all' ? 'الكل' : ar(s)}</button>)}</div> : null}
      <div className="card"><DataTable columns={cols} rows={list.data} loading={list.isLoading} empty="لا بلاغات" /></div>
    </>
  );
}
