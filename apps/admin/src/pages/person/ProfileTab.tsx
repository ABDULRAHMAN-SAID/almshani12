import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Learner, PersonDetail } from '@manassah/shared';
import { api, day, when } from '../../api';
import { Badge, Avatar, DataTable, ar, useToast, errMsg, useConfirm, useCatalog, can, type Column } from '../../ui';
import { LearnerForm } from './LearnerForm';
import type { TabProps } from './types';

type LearnerRow = PersonDetail['learners'][number];

/** الملف: بيانات الحساب والهويات (المعرّف مقنَّع) وجدول المتعلّمين بإجراءات الدعم */
export function ProfileTab({ me, d, id }: TabProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const cat = useCatalog();
  const [form, setForm] = useState<{ open: boolean; initial: Learner | null }>({ open: false, initial: null });
  const inv = () => { qc.invalidateQueries({ queryKey: ['adm-user', id] }); qc.invalidateQueries({ queryKey: ['adm-users'] }); };
  const activate = useMutation({ mutationFn: (lid: number) => api.post<PersonDetail>(`/admin/users/${id}/learners/${lid}/activate`), onSuccess: r => { toast('عُيّن المتعلّم النشط'); qc.setQueryData(['adm-user', id], r); inv(); }, onError: e => toast(errMsg(e)) });
  const archive = useMutation({ mutationFn: (lid: number) => api.delete<PersonDetail>(`/admin/users/${id}/learners/${lid}`), onSuccess: r => { toast('أُرشف المتعلّم'); qc.setQueryData(['adm-user', id], r); inv(); }, onError: e => toast(errMsg(e)) });
  const askArchive = async (l: LearnerRow) => { const r = await confirm({ title: `أرشفة ${l.displayName}`, body: 'يُخفى المتعلّم من الحساب وتبقى حصصه في السجل. لا يمكن أرشفة متعلّم له حصص قادمة ولا آخر متعلّم.', danger: true, confirmLabel: 'أرشفة' }); if (r) archive.mutate(l.id); };
  const subjectName = (sid: number) => cat.data?.subjects.find(s => s.id === sid)?.name ?? `#${sid}`;
  const support = can(me, 'support');
  const cols: Column<LearnerRow>[] = [
    { key: 'name', label: 'المتعلّم', render: l => <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Avatar url={l.avatarUrl} name={l.displayName} size={28} /><span><b>{l.displayName}</b>{l.gender ? <div className="muted small">{ar(l.gender)}</div> : null}</span></span> },
    { key: 'kind', label: 'النوع', render: l => <Badge tone={l.isSelf ? 'brand' : 'gold'}>{l.isSelf ? ar('self') : ar('child')}</Badge> },
    { key: 'grade', label: 'الصف / الفصل', render: l => <>{l.gradeName ?? '—'}{l.semesterName ? <div className="muted small">{l.semesterName}</div> : null}</> },
    { key: 'subjects', label: 'المواد', render: l => <span className="chips">{l.subjectIds.map(s => <Badge key={s}>{subjectName(s)}</Badge>)}{!l.subjectIds.length ? '—' : null}</span> },
    { key: 'school', label: 'المدرسة', render: l => l.school ?? '—' },
    { key: 'bookings', label: 'الحجوزات', className: 'num', render: l => l.bookingsCount },
    { key: 'flags', label: '', render: l => <>{l.id === d.activeLearnerId ? <Badge tone="success">النشط</Badge> : null} {l.archivedAt ? <Badge tone="danger" title={when(l.archivedAt)}>مؤرشف</Badge> : null}</> },
    { key: 'act', label: '', className: 'actions', hide: !support, render: l => l.archivedAt ? null : <><button className="btn ghost sm" onClick={() => setForm({ open: true, initial: l })}>تعديل</button> {l.id !== d.activeLearnerId ? <button className="btn ghost sm" disabled={activate.isPending} onClick={() => activate.mutate(l.id)}>تعيين نشط</button> : null} <button className="btn ghost sm" disabled={archive.isPending} onClick={() => askArchive(l)}>أرشفة</button></> },
  ];
  return (
    <>
      <div className="grid grid-2">
        <div className="card">
          <h2>البيانات</h2>
          <dl className="kv">
            <dt>الاسم</dt><dd>{d.profile.displayName || '—'}</dd><dt>الجنس</dt><dd>{d.profile.gender ? ar(d.profile.gender) : '—'}</dd><dt>الدولة</dt><dd className="num">{d.profile.countryCode}</dd>
            <dt>اللغة / المنطقة</dt><dd className="num">{d.locale} · {d.timezone}</dd><dt>الإعداد الأولي</dt><dd>{d.onboardingCompleted ? <Badge tone="success">مكتمل</Badge> : <Badge tone="warning">غير مكتمل</Badge>}</dd>
            <dt>أُنشئ</dt><dd className="num">{when(d.createdAt)}</dd><dt>آخر دخول</dt><dd className="num">{when(d.lastLoginAt)}</dd>
            {d.profile.bio ? <><dt>النبذة</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{d.profile.bio}</dd></> : null}
          </dl>
        </div>
        <div className="card">
          <h2>الهويات</h2>
          {d.identities.length ? <table><thead><tr><th>المزوّد</th><th>المعرّف (مقنَّع)</th><th>منذ</th></tr></thead><tbody>{d.identities.map((i, k) => <tr key={k}><td>{i.provider}</td><td className="mono">{i.providerUid}</td><td className="num small">{day(i.createdAt)}</td></tr>)}</tbody></table> : <p className="muted">لا هويات مسجّلة</p>}
          <h3 style={{ marginTop: 14 }}>الأرقام</h3>
          <div className="chips"><Badge>طلبات {d.counts.orders}</Badge><Badge>حجوزات {d.counts.bookings}</Badge><Badge>امتلاك {d.counts.entitlements}</Badge><Badge>تقييمات {d.counts.reviews}</Badge><Badge>بلاغات {d.counts.reportsFiled} / ضدّه {d.counts.reportsAgainst}</Badge><Badge>أجهزة {d.counts.devices}</Badge><Badge>جلسات نشطة {d.counts.activeSessions}</Badge><Badge>إشعارات غير مقروءة {d.counts.unreadNotifications}</Badge></div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="row between" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>المتعلّمون</h2>{support && d.status !== 'deleted' ? <button className="btn secondary sm" disabled={d.learners.filter(l => !l.archivedAt).length >= 6} onClick={() => setForm({ open: true, initial: null })}>إضافة متعلّم</button> : null}</div>
        <DataTable columns={cols} rows={d.learners} rowClass={l => l.archivedAt ? 'dim' : ''} empty="لا متعلّمين في هذا الحساب" />
        <p className="muted small" style={{ marginTop: 8 }}>الحد الأقصى ٦ متعلّمين غير مؤرشفين لكل حساب. الأرشفة لا تحذف السجلات.</p>
      </div>
      {form.open ? <LearnerForm accountId={id} initial={form.initial} onClose={() => setForm({ open: false, initial: null })} /> : null}
    </>
  );
}
