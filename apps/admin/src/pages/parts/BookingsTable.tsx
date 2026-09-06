import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminBooking, PageMeta } from '@manassah/shared';
import { api, money, when } from '../../api';
import { Badge, Modal, Field, DataTable, PersonLink, TeacherLink, LearnerChip, STATUS_TONE, ar, useToast, errMsg, can, type Me, type Column } from '../../ui';

export const BOOKING_STATUSES = ['pending_payment', 'confirmed', 'in_progress', 'completed', 'no_show', 'disputed', 'cancelled_by_student', 'cancelled_by_teacher', 'expired'];
type Row = AdminBooking & { attendance?: { teacherSeconds: number; studentSeconds: number; teacherJoinedAt: string | null; studentJoinedAt: string | null } | null };
const mins = (s: number) => `${Math.round(s / 60)} د`;

/** جدول الحجوزات المشترك: الصفحة العامة وتبويبا الشخص/المعلّم — النزاع لدور الدعم فقط */
export function BookingsTable({ me, params = {}, initialStatus = '', search, hideStudent, hideTeacher }: { me: Me; params?: Record<string, unknown>; initialStatus?: string; search?: boolean; hideStudent?: boolean; hideTeacher?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState(initialStatus);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Row | null>(null);
  const [res, setRes] = useState<'refund_student' | 'pay_teacher' | 'split'>('refund_student');
  const [reason, setReason] = useState('');
  const list = useQuery({ queryKey: ['adm-bookings', params, status, q, page], queryFn: () => api.get<{ data: Row[]; meta: PageMeta }>('/admin/bookings', { ...params, status: status || undefined, q: q || undefined, page, limit: 20 }) });
  const resolve = useMutation({ mutationFn: () => api.post(`/admin/bookings/${sel!.id}/resolve`, { resolution: res, reason }), onSuccess: () => { toast('تم حلّ النزاع'); setSel(null); qc.invalidateQueries({ queryKey: ['adm-bookings'] }); qc.invalidateQueries({ queryKey: ['overview'] }); }, onError: e => toast(errMsg(e)) });
  const support = can(me, 'support');
  const cols: Column<Row>[] = [
    { key: 'id', label: '#', className: 'num', render: b => b.id },
    { key: 'at', label: 'الموعد', className: 'num small', render: b => when(b.startsAt) },
    { key: 'subject', label: 'المادة', render: b => b.subject.name },
    { key: 'learner', label: 'المتعلّم', render: b => <LearnerChip learner={b.learner} /> },
    { key: 'student', label: 'الحساب', hide: hideStudent, render: b => <PersonLink id={b.student.id} name={b.student.name} /> },
    { key: 'teacher', label: 'المعلّم', hide: hideTeacher, render: b => <TeacherLink id={b.teacher.id} name={b.teacher.name} /> },
    { key: 'dur', label: 'المدة', className: 'num', render: b => `${b.durationMinutes} د · ${b.mode === 'group' ? 'جماعي' : 'فردي'}` },
    { key: 'price', label: 'السعر', className: 'num', render: b => money(b.price) },
    { key: 'status', label: 'الحالة', render: b => <Badge tone={STATUS_TONE[b.status]}>{ar(b.status)}</Badge> },
    { key: 'att', label: 'الحضور', className: 'small num', render: b => b.attendance ? `م ${mins(b.attendance.teacherSeconds)} · ط ${mins(b.attendance.studentSeconds)}` : '—' },
    { key: 'act', label: '', className: 'actions', hide: !support, render: b => ['completed', 'no_show', 'disputed', 'in_progress'].includes(b.status) ? <button className="btn secondary sm" onClick={() => { setSel(b); setReason(''); }}>نزاع</button> : null },
  ];
  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">كل الحالات</option>{BOOKING_STATUSES.map(s => <option key={s} value={s}>{ar(s)}</option>)}</select>
        {search ? <input placeholder="اسم الطالب أو المعلّم أو رقم الحجز" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} /> : null}
        <span className="muted small">{list.data?.meta.total ?? 0} حجز</span>
      </div>
      <div className="card">
        <DataTable columns={cols} rows={list.data?.data} meta={list.data?.meta} onPage={setPage} loading={list.isLoading} empty="لا حجوزات"
          expand={b => <dl className="kv small"><dt>الطلب / الباقة</dt><dd className="num">{b.orderId ? `طلب #${b.orderId}` : '—'}{b.packagePurchaseId ? ` · باقة #${b.packagePurchaseId}` : ''}</dd><dt>الإلغاء</dt><dd>{b.cancelReason ?? '—'}{b.refundPercent != null ? ` · استرجاع ${b.refundPercent}٪` : ''}{b.cancelledAt ? ` · ${when(b.cancelledAt as string)}` : ''}</dd><dt>ملاحظة</dt><dd>{b.note ?? '—'}</dd><dt>مهلة الدفع</dt><dd className="num">{when(b.expiresAt)}</dd><dt>أُنشئ</dt><dd className="num">{when(b.createdAt)}</dd></dl>} />
      </div>
      {sel ? (
        <Modal title={`حلّ نزاع الحجز #${sel.id}`} onClose={() => setSel(null)} footer={<button className="btn" disabled={resolve.isPending || reason.trim().length < 3} onClick={() => resolve.mutate()}>تطبيق القرار</button>}>
          <dl className="kv"><dt>الموعد</dt><dd className="num">{when(sel.startsAt)}</dd><dt>المتعلّم</dt><dd><LearnerChip learner={sel.learner} /></dd><dt>الحساب / المعلّم</dt><dd>{sel.student.name} / {sel.teacher.name}</dd><dt>الحضور</dt><dd className="num">{sel.attendance ? `المعلّم ${mins(sel.attendance.teacherSeconds)} (${when(sel.attendance.teacherJoinedAt)}) · الطالب ${mins(sel.attendance.studentSeconds)} (${when(sel.attendance.studentJoinedAt)})` : 'لا سجلّ حضور'}</dd><dt>المبلغ</dt><dd className="num">{money(sel.price)}</dd></dl>
          <Field label="القرار"><select value={res} onChange={e => setRes(e.target.value as never)}><option value="refund_student">استرجاع كامل للطالب</option><option value="split">مناصفة</option><option value="pay_teacher">صرف للمعلّم</option></select></Field>
          <Field label="السبب (يُسجَّل)"><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </Modal>
      ) : null}
    </>
  );
}
