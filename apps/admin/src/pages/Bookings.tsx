import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, money, when } from '../api';
import { Page, Badge, Modal, Field, Empty, STATUS_TONE, ar, useToast, errMsg } from '../ui';

/** الحجوزات: بحث بالحالة والاسم، الحضور المسجَّل، وحلّ النزاعات بقرار موثَّق */
export default function Bookings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<any | null>(null);
  const [res, setRes] = useState<'refund_student' | 'pay_teacher' | 'split'>('refund_student');
  const [reason, setReason] = useState('');
  const list = useQuery({ queryKey: ['adm-bookings', status, q], queryFn: () => api.get<{ data: any[]; meta: any }>('/admin/bookings', { status: status || undefined, q: q || undefined, limit: 60 }) });
  const resolve = useMutation({ mutationFn: () => api.post(`/admin/bookings/${sel.id}/resolve`, { resolution: res, reason }), onSuccess: () => { toast('تم حلّ النزاع'); setSel(null); qc.invalidateQueries({ queryKey: ['adm-bookings'] }); }, onError: e => toast(errMsg(e)) });
  const mins = (s: number) => `${Math.round(s / 60)} د`;
  return (
    <Page title="الحجوزات">
      <div className="toolbar">
        <select value={status} onChange={e => setStatus(e.target.value)}><option value="">كل الحالات</option>{['pending_payment', 'confirmed', 'in_progress', 'completed', 'no_show', 'disputed', 'cancelled_by_student', 'cancelled_by_teacher', 'expired'].map(s => <option key={s} value={s}>{ar(s)}</option>)}</select>
        <input placeholder="اسم الطالب أو المعلّم أو رقم الحجز" value={q} onChange={e => setQ(e.target.value)} />
        <span className="muted small">{list.data?.meta.total ?? 0} حجز</span>
      </div>
      <div className="card tbl">
        {list.data?.data.length ? (
          <table><thead><tr><th>#</th><th>الموعد</th><th>المادة</th><th>الطالب</th><th>المعلّم</th><th>المدة</th><th>السعر</th><th>الحالة</th><th>الحضور</th><th></th></tr></thead>
            <tbody>{list.data.data.map(b => <tr key={b.id}><td className="num">{b.id}</td><td className="num small">{when(b.startsAt)}</td><td>{b.subject.name}</td><td>{b.student.name}</td><td>{b.teacher.name}</td><td className="num">{b.durationMinutes} د · {b.mode === 'group' ? 'جماعي' : 'فردي'}</td><td className="num">{money(b.price)}</td><td><Badge tone={STATUS_TONE[b.status]}>{ar(b.status)}</Badge></td><td className="small num">{b.attendance ? `م ${mins(b.attendance.teacherSeconds)} · ط ${mins(b.attendance.studentSeconds)}` : '—'}</td><td className="actions">{['completed', 'no_show', 'disputed', 'in_progress'].includes(b.status) ? <button className="btn secondary sm" onClick={() => { setSel(b); setReason(''); }}>نزاع</button> : null}</td></tr>)}</tbody></table>
        ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا حجوزات'} />}
      </div>
      {sel ? (
        <Modal title={`حلّ نزاع الحجز #${sel.id}`} onClose={() => setSel(null)} footer={<button className="btn" disabled={resolve.isPending || reason.trim().length < 3} onClick={() => resolve.mutate()}>تطبيق القرار</button>}>
          <dl className="kv"><dt>الموعد</dt><dd className="num">{when(sel.startsAt)}</dd><dt>الطالب / المعلّم</dt><dd>{sel.student.name} / {sel.teacher.name}</dd><dt>الحضور</dt><dd className="num">{sel.attendance ? `المعلّم ${mins(sel.attendance.teacherSeconds)} (${when(sel.attendance.teacherJoinedAt)}) · الطالب ${mins(sel.attendance.studentSeconds)} (${when(sel.attendance.studentJoinedAt)})` : 'لا سجلّ حضور'}</dd><dt>المبلغ</dt><dd className="num">{money(sel.price)}</dd></dl>
          <Field label="القرار"><select value={res} onChange={e => setRes(e.target.value as never)}><option value="refund_student">استرجاع كامل للطالب</option><option value="split">مناصفة</option><option value="pay_teacher">صرف للمعلّم</option></select></Field>
          <Field label="السبب (يُسجَّل)"><textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </Modal>
      ) : null}
    </Page>
  );
}
