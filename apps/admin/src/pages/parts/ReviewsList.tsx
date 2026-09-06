import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReviewAdmin } from '@manassah/shared';
import { api, when } from '../../api';
import { Badge, DataTable, PersonLink, TeacherLink, ar, useToast, errMsg, useConfirm, type Column } from '../../ui';

/** قائمة تقييمات للطاقم (تشمل المخفيّة بسببها): إخفاء بسبب مسجَّل / إظهار — تُعيد حساب تقييم الهدف */
export function ReviewsList({ rows, loading, showAuthor = true, showTarget = true, onChanged }: { rows: ReviewAdmin[] | undefined; loading?: boolean; showAuthor?: boolean; showTarget?: boolean; onChanged?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const done = (m: string) => () => { toast(m); qc.invalidateQueries({ queryKey: ['adm-reviews'] }); qc.invalidateQueries({ queryKey: ['adm-teacher'] }); onChanged?.(); };
  const hide = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => api.post(`/admin/reviews/${id}/hide`, { reason }), onSuccess: done('أُخفي التقييم'), onError: e => toast(errMsg(e)) });
  const unhide = useMutation({ mutationFn: (id: number) => api.post(`/admin/reviews/${id}/unhide`), onSuccess: done('أُظهر التقييم'), onError: e => toast(errMsg(e)) });
  const askHide = async (r: ReviewAdmin) => { const v = await confirm({ title: `إخفاء تقييم ${r.author.name}`, body: r.comment ?? undefined, reasonRequired: true, danger: true, confirmLabel: 'إخفاء' }); if (v) hide.mutate({ id: r.id, reason: v.reason }); };
  const cols: Column<ReviewAdmin>[] = [
    { key: 'author', label: 'الكاتب', hide: !showAuthor, render: r => <PersonLink id={r.author.id} name={r.author.name} /> },
    { key: 'target', label: 'الهدف', hide: !showTarget, render: r => <><Badge>{ar(r.targetType)}</Badge> {r.targetType === 'teacher' ? <TeacherLink id={r.targetId} name={r.targetTitle} /> : r.targetTitle || `#${r.targetId}`}</> },
    { key: 'rating', label: 'التقييم', className: 'num', render: r => `${'★'.repeat(r.rating)}${'☆'.repeat(Math.max(0, 5 - r.rating))}` },
    { key: 'comment', label: 'التعليق', render: r => <>{r.comment ?? <span className="muted">—</span>}{r.status === 'hidden' ? <div className="small" style={{ color: 'var(--danger)' }}>مخفي: {r.hiddenReason ?? '—'}</div> : null}</> },
    { key: 'status', label: 'الحالة', render: r => <Badge tone={r.status === 'hidden' ? 'danger' : 'success'}>{ar(r.status)}</Badge> },
    { key: 'at', label: 'التاريخ', className: 'num small', render: r => when(r.createdAt) },
    { key: 'act', label: '', className: 'actions', render: r => r.status === 'hidden' ? <button className="btn secondary sm" disabled={unhide.isPending} onClick={() => unhide.mutate(r.id)}>إظهار</button> : <button className="btn danger sm" disabled={hide.isPending} onClick={() => askHide(r)}>إخفاء (بسبب)</button> },
  ];
  return <DataTable columns={cols} rows={rows} loading={loading} rowClass={r => r.status === 'hidden' ? 'dim' : ''} empty="لا تقييمات" />;
}
