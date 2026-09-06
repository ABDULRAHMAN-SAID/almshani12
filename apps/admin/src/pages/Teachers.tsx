import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TeacherAdminRow, TeacherAdminDetail, PageMeta } from '@manassah/shared';
import { api, money, when, pct } from '../api';
import { Page, Badge, Modal, Field, Empty, DataTable, TeacherLink, Avatar, STATUS_TONE, ar, useToast, errMsg, useConfirm, useDebounced, useCatalog, can, type Me, type Column } from '../ui';

/** تحقّق المعلّمين: قائمة بمرشّحات (الحالة/المادة/الصف/التقييم) وترقيم، وقرار سريع مسجَّل — الاسم يفتح صفحة المعلّم */
export default function Teachers({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? 'pending');
  const [q, setQ] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [minRating, setMinRating] = useState('');
  const [sort, setSort] = useState('queue');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [rate, setRate] = useState('');
  const dq = useDebounced(q);
  const cat = useCatalog();
  const list = useQuery({ queryKey: ['adm-teachers', status, dq, subjectId, gradeId, minRating, sort, page], queryFn: () => api.get<{ data: TeacherAdminRow[]; meta: PageMeta }>('/admin/teachers', { status: status || undefined, q: dq || undefined, subjectId: subjectId || undefined, gradeId: gradeId || undefined, minRating: minRating || undefined, sort, page, limit: 30 }) });
  const detail = useQuery({ queryKey: ['adm-teacher', open], queryFn: () => api.get<TeacherAdminDetail>(`/admin/teachers/${open}`), enabled: !!open });
  const decide = useMutation({ mutationFn: (b: { decision: string; reason?: string | null; commissionRate?: number }) => api.post(`/admin/teachers/${open}/decision`, b), onSuccess: () => { toast('تم تسجيل القرار'); qc.invalidateQueries({ queryKey: ['adm-teachers'] }); qc.invalidateQueries({ queryKey: ['adm-teacher', open] }); qc.invalidateQueries({ queryKey: ['overview'] }); }, onError: e => toast(errMsg(e)) });
  const suspend = async () => { const r = await confirm({ title: 'إيقاف المعلّم', body: 'إيقاف المعلّم يلغي حصصه القادمة ويعيد المبالغ للطلاب.', danger: true, confirmLabel: 'إيقاف' }); if (r) decide.mutate({ decision: 'suspended', reason }); };
  const reset = (f: () => void) => { f(); setPage(1); };
  const d = detail.data;
  const cols: Column<TeacherAdminRow>[] = [
    { key: 'name', label: 'المعلّم', render: t => <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Avatar url={t.avatarUrl} name={t.name} size={30} /><span><b><TeacherLink id={t.id} name={t.name} /></b><div className="muted small num">{t.phone ?? t.email}</div></span></span> },
    { key: 'spec', label: 'التخصّص', render: t => t.specialty ?? t.headline ?? '—' },
    { key: 'exp', label: 'الخبرة', className: 'num', render: t => `${t.yearsExp} سنة` },
    { key: 'rating', label: 'التقييم', className: 'num', render: t => t.ratingCount ? `${t.ratingAvg.toFixed(1)} ★ · ${t.ratingCount}` : '—' },
    { key: 'status', label: 'الحالة', render: t => <Badge tone={STATUS_TONE[t.status]}>{ar(t.status)}</Badge> },
    { key: 'applied', label: 'قدّم في', className: 'num small', render: t => when(t.appliedAt) },
    { key: 'lessons', label: 'الحصص / الطلاب', className: 'num', render: t => `${t.lessonsCount} / ${t.studentsCount}` },
    { key: 'act', label: '', className: 'actions', render: t => <button className="btn secondary sm" onClick={() => { setOpen(t.id); setReason(''); setRate(''); }}>مراجعة</button> },
  ];
  return (
    <Page title="المعلّمون" sub="كل قرار يُسجَّل باسم من اتّخذه — الاسم يفتح صفحة المعلّم الكاملة">
      <div className="toolbar">
        {['pending', 'under_review', 'verified', 'rejected', 'suspended', ''].map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => reset(() => setStatus(s))}>{s ? ar(s) : 'الكل'}</button>)}
        <input placeholder="بحث بالاسم أو الهاتف" value={q} onChange={e => reset(() => setQ(e.target.value))} />
        <select value={subjectId} onChange={e => reset(() => setSubjectId(e.target.value))} style={{ minWidth: 140 }}><option value="">كل المواد</option>{cat.data?.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={gradeId} onChange={e => reset(() => setGradeId(e.target.value))} style={{ minWidth: 140 }}><option value="">كل الصفوف</option>{cat.data?.grades.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <select value={minRating} onChange={e => reset(() => setMinRating(e.target.value))} style={{ minWidth: 120 }}><option value="">أي تقييم</option>{['3', '4', '4.5'].map(r => <option key={r} value={r}>{r} ★ فأكثر</option>)}</select>
        <select value={sort} onChange={e => reset(() => setSort(e.target.value))} style={{ minWidth: 140 }}><option value="queue">طابور المراجعة</option><option value="rating_desc">الأعلى تقييماً</option><option value="lessons_desc">الأكثر حصصاً</option><option value="applied_desc">الأحدث تقديماً</option><option value="name">الاسم</option></select>
        <span className="muted small">{list.data?.meta.total ?? 0} معلّم</span>
      </div>
      <div className="card"><DataTable columns={cols} rows={list.data?.data} meta={list.data?.meta} onPage={setPage} loading={list.isLoading} empty="لا معلّمين في هذه الحالة" /></div>
      {open ? (
        <Modal title={d?.name ?? '…'} onClose={() => setOpen(null)}>
          {d ? (<>
            <div className="row" style={{ marginBottom: 12 }}><Badge tone={STATUS_TONE[d.status]}>{ar(d.status)}</Badge><span className="muted small">عمولة {pct(d.commissionRate)} · {d.stats.bookings.total} حجز · أرباح {money(d.stats.earnings.lifetime)}</span><TeacherLink id={d.id} name="الصفحة الكاملة ←" /></div>
            <dl className="kv">
              <dt>الهاتف / البريد</dt><dd className="num">{d.phone ?? '—'} · {d.email ?? '—'}</dd>
              <dt>العنوان المهني</dt><dd>{d.headline ?? '—'}</dd><dt>المؤهّل</dt><dd>{d.qualification ?? '—'} — {d.specialty ?? '—'}</dd>
              <dt>الخبرة</dt><dd>{d.yearsExp} سنة · {d.languages.join('، ')} · {d.gender === 'female' ? 'معلّمة' : d.gender === 'male' ? 'معلّم' : '—'}</dd>
              <dt>النبذة</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{d.bio ?? '—'}</dd>
              <dt>المواد والصفوف</dt><dd>{d.subjects.map(s => `${s.subject} (${s.grade})`).join('، ') || '—'}</dd>
              <dt>الأسعار</dt><dd>{d.prices.map(p => `${p.durationMinutes} د ${p.mode === 'group' ? 'جماعي' : 'فردي'}: ${money(p.price)}`).join(' · ') || '—'}</dd>
              <dt>المستندات</dt><dd>{d.documents.length ? d.documents.map(x => <div key={x.id}><a href={x.url} target="_blank" rel="noreferrer">{ar(x.type)} — {x.name ?? ''}</a> <Badge tone={STATUS_TONE[x.status]}>{ar(x.status)}</Badge></div>) : '—'}<div className="muted small">الروابط صالحة ١٠ دقائق</div></dd>
              <dt>السجلّ</dt><dd>{d.history.length ? d.history.map((h, i) => <div key={i} className="small">{ar(h.decision)} — {h.reviewer ?? 'النظام'} — {when(h.decided_at)}{h.reason ? ` — ${h.reason}` : ''}</div>) : '—'}</dd>
            </dl>
            {can(me, 'admin') ? (
              <div className="card" style={{ marginTop: 16, background: 'var(--bg-2)' }}>
                <h3>القرار</h3>
                <div className="grid grid-2"><Field label="السبب (يصل للمعلّم عند الرفض/الإيقاف)"><input value={reason} onChange={e => setReason(e.target.value)} /></Field><Field label="نسبة العمولة (اختياري، مثال 0.15)"><input value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" /></Field></div>
                <div className="row end">
                  <button className="btn secondary" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'under_review', reason })}>قيد المراجعة</button>
                  <button className="btn danger" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'rejected', reason })}>رفض</button>
                  {d.status === 'verified' ? <button className="btn danger" disabled={decide.isPending} onClick={suspend}>إيقاف</button> : null}
                  <button className="btn success" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'verified', reason, commissionRate: rate ? Number(rate) : undefined })}>اعتماد</button>
                </div>
              </div>
            ) : <p className="muted small">القرار للمدير فقط — يمكنك المراجعة.</p>}
          </>) : <Empty text="جارٍ التحميل…" />}
        </Modal>
      ) : null}
    </Page>
  );
}
