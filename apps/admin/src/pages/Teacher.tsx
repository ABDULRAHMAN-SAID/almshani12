import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TeacherAdminDetail, ReviewAdmin } from '@manassah/shared';
import { api, money, when, day, pct, share } from '../api';
import { Page, Empty, ErrorState, Badge, Tabs, Drawer, Field, Avatar, PersonLink, Kpi, STATUS_TONE, ar, useToast, errMsg, useConfirm, can, WEEKDAYS, type Me } from '../ui';
import { DocumentsTab } from './teacher/DocumentsTab';
import { EarningsTab } from './teacher/EarningsTab';
import { StudentsTab } from './teacher/StudentsTab';
import { BookingsTable } from './parts/BookingsTable';
import { PayoutsTable } from './parts/PayoutsTable';
import { ReviewsList } from './parts/ReviewsList';
import { AuditTable } from './parts/AuditTable';

/** قرار التحقّق (للمدير): الحالة + السبب + عمولة اختيارية — يُسجَّل ويُبلَّغ المعلّم */
function DecisionDrawer({ d, onClose }: { d: TeacherAdminDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [decision, setDecision] = useState<'under_review' | 'verified' | 'rejected' | 'suspended'>(d.status === 'verified' ? 'suspended' : 'verified');
  const [reason, setReason] = useState('');
  const [rate, setRate] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/admin/teachers/${d.id}/decision`, { decision, reason: reason.trim() || null, commissionRate: rate ? Number(rate) : undefined }), onSuccess: () => { toast('تم تسجيل القرار'); qc.invalidateQueries({ queryKey: ['adm-teacher', d.id] }); qc.invalidateQueries({ queryKey: ['adm-teachers'] }); qc.invalidateQueries({ queryKey: ['overview'] }); onClose(); }, onError: e => toast(errMsg(e)) });
  const needsReason = decision === 'rejected' || decision === 'suspended';
  return (
    <Drawer title="قرار التحقّق" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>إلغاء</button><button className={`btn ${needsReason ? 'danger' : 'success'}`} disabled={m.isPending || (needsReason && reason.trim().length < 3)} onClick={() => m.mutate()}>تطبيق</button></>}>
      <Field label="القرار"><select value={decision} onChange={e => setDecision(e.target.value as never)}><option value="under_review">قيد المراجعة</option><option value="verified">اعتماد</option><option value="rejected">رفض</option>{d.status === 'verified' ? <option value="suspended">إيقاف</option> : null}</select></Field>
      {decision === 'suspended' ? <p className="error">إيقاف المعلّم يلغي حصصه القادمة ويعيد المبالغ للطلاب.</p> : null}
      <Field label={needsReason ? 'السبب (يصل للمعلّم، ٣ أحرف على الأقل)' : 'السبب (اختياري)'}><textarea value={reason} onChange={e => setReason(e.target.value)} autoFocus /></Field>
      {decision === 'verified' ? <Field label="نسبة العمولة (اختياري، مثال 0.15)" hint={`الحالية ${pct(d.commissionRate)}`}><input value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" className="mono" /></Field> : null}
    </Drawer>
  );
}

/** تعديل بيانات المعلّم (للمدير): العمولة/العنوان/التخصّص/الخبرة بسبب مسجَّل */
function EditDrawer({ d, onClose }: { d: TeacherAdminDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ commissionRate: String(d.commissionRate), headline: d.headline ?? '', specialty: d.specialty ?? '', yearsExp: String(d.yearsExp), reason: '' });
  const m = useMutation({
    mutationFn: () => {
      const b: Record<string, unknown> = { reason: f.reason.trim() };
      if (Number(f.commissionRate) !== d.commissionRate) b.commissionRate = Number(f.commissionRate);
      if (f.headline.trim() !== (d.headline ?? '')) b.headline = f.headline.trim();
      if (f.specialty.trim() !== (d.specialty ?? '')) b.specialty = f.specialty.trim();
      if (Number(f.yearsExp) !== d.yearsExp) b.yearsExp = Number(f.yearsExp);
      return api.patch(`/admin/teachers/${d.id}`, b);
    },
    onSuccess: () => { toast('حُفظ'); qc.invalidateQueries({ queryKey: ['adm-teacher', d.id] }); qc.invalidateQueries({ queryKey: ['adm-teachers'] }); onClose(); }, onError: e => toast(errMsg(e)),
  });
  const rate = Number(f.commissionRate);
  const ok = f.reason.trim().length >= 3 && Number.isFinite(rate) && rate >= 0 && rate <= 0.6 && Number.isInteger(Number(f.yearsExp)) && Number(f.yearsExp) >= 0;
  return (
    <Drawer title="تعديل بيانات المعلّم" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>إلغاء</button><button className="btn" disabled={!ok || m.isPending} onClick={() => m.mutate()}>حفظ</button></>}>
      <Field label="نسبة العمولة (0 – 0.6)" hint="تغييرها يُسجَّل في سجلّ التحقّق مع السبب"><input value={f.commissionRate} inputMode="decimal" className="mono" onChange={e => setF(s => ({ ...s, commissionRate: e.target.value }))} /></Field>
      <Field label="العنوان المهني"><input value={f.headline} onChange={e => setF(s => ({ ...s, headline: e.target.value }))} /></Field>
      <Field label="التخصّص"><input value={f.specialty} onChange={e => setF(s => ({ ...s, specialty: e.target.value }))} /></Field>
      <Field label="سنوات الخبرة"><input value={f.yearsExp} inputMode="numeric" className="mono" onChange={e => setF(s => ({ ...s, yearsExp: e.target.value }))} /></Field>
      <Field label="السبب (يُسجَّل، ٣ أحرف على الأقل)"><textarea value={f.reason} onChange={e => setF(s => ({ ...s, reason: e.target.value }))} /></Field>
    </Drawer>
  );
}

/** التدريس: مصفوفة المواد × الصفوف، الأسعار، الباقات، الأسلوب واللغات والمؤهّل والنبذة */
function TeachingTab({ d }: { d: TeacherAdminDetail }) {
  const subjects = [...new Map(d.subjects.map(s => [s.subjectId, s.subject])).entries()];
  const grades = [...new Map(d.subjects.map(s => [s.gradeId, s.grade])).entries()];
  const has = (sid: number, gid: number) => d.subjects.some(s => s.subjectId === sid && s.gradeId === gid);
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <div className="card"><h2>المواد × الصفوف</h2>{subjects.length ? <div className="tbl"><table><thead><tr><th>المادة</th>{grades.map(([id, g]) => <th key={id}>{g}</th>)}</tr></thead><tbody>{subjects.map(([sid, s]) => <tr key={sid}><td><b>{s}</b></td>{grades.map(([gid]) => <td key={gid} style={{ textAlign: 'center' }}>{has(sid, gid) ? <Badge tone="success">✓</Badge> : <span className="muted">·</span>}</td>)}</tr>)}</tbody></table></div> : <Empty text="لم يحدّد المعلّم موادّه بعد" />}
        <h2 style={{ marginTop: 16 }}>الأسعار</h2>{d.prices.length ? <table><thead><tr><th>المدة</th><th>النمط</th><th>السعر</th></tr></thead><tbody>{d.prices.map((p, i) => <tr key={i}><td className="num">{p.durationMinutes} د</td><td>{p.mode === 'group' ? 'جماعي' : 'فردي'}</td><td className="num">{money(p.price)}</td></tr>)}</tbody></table> : <Empty text="لا أسعار" />}
        <h2 style={{ marginTop: 16 }}>الباقات</h2>{d.packages.length ? <table><thead><tr><th>الحصص</th><th>المدة</th><th>النمط</th><th>السعر</th><th>الحالة</th></tr></thead><tbody>{d.packages.map(p => <tr key={p.id}><td className="num">{p.lessonsCount}</td><td className="num">{p.durationMinutes} د</td><td>{p.mode === 'group' ? 'جماعي' : 'فردي'}</td><td className="num">{money(p.price)}</td><td><Badge tone={p.active ? 'success' : ''}>{p.active ? 'مفعّلة' : 'موقوفة'}</Badge></td></tr>)}</tbody></table> : <Empty text="لا باقات" />}</div>
      <div className="card"><h2>الملف المهني</h2><dl className="kv">
        <dt>المؤهّل</dt><dd>{d.qualification ?? '—'}</dd><dt>التخصّص</dt><dd>{d.specialty ?? '—'}</dd><dt>الخبرة</dt><dd className="num">{d.yearsExp} سنة</dd>
        <dt>اللغات</dt><dd>{d.languages.length ? d.languages.join('، ') : '—'}</dd><dt>أسلوب التدريس</dt><dd><span className="chips">{d.teachingStyle.map(s => <Badge key={s}>{s}</Badge>)}{!d.teachingStyle.length ? '—' : null}</span></dd>
        <dt>النبذة</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{d.bio ?? '—'}</dd></dl></div>
    </div>
  );
}

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
/** التوفّر: شبكة أسبوعية (٧ أعمدة × ساعات) للقراءة فقط، القواعد بمدد الحصة/الاستراحة، والإجازات */
function AvailabilityTab({ d }: { d: TeacherAdminDetail }) {
  const on = (wd: number, h: number) => d.availability.some(a => a.weekday === wd && toMin(a.startTime) <= h * 60 && toMin(a.endTime) >= (h + 1) * 60);
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <div className="card"><h2>الأسبوع</h2>
        <div className="week"><div /> {WEEKDAYS.map(w => <div className="h" key={w}>{w}</div>)}{HOURS.map(h => <div key={h} style={{ display: 'contents' }}><div className="t num">{String(h).padStart(2, '0')}:00</div>{WEEKDAYS.map((_, wd) => <div key={wd} className={`c ${on(wd, h) ? 'on' : ''}`} title={`${WEEKDAYS[wd]} ${h}:00`} />)}</div>)}</div>
        <p className="muted small" style={{ marginTop: 8 }}>الأخضر = ساعة كاملة داخل نافذة توفّر (بتوقيت المعلّم).</p></div>
      <div className="card"><h2>القواعد</h2>{d.availability.length ? <table><thead><tr><th>اليوم</th><th>من</th><th>إلى</th><th>الحصة / الاستراحة</th></tr></thead><tbody>{d.availability.map(a => <tr key={a.id}><td>{WEEKDAYS[a.weekday]}</td><td className="num">{a.startTime}</td><td className="num">{a.endTime}</td><td className="num">{a.slotMinutes} د / {a.breakMinutes} د</td></tr>)}</tbody></table> : <Empty text="لم يضبط المعلّم توفّره بعد" />}
        <h2 style={{ marginTop: 16 }}>الإجازات</h2>{d.timeOff.length ? <table><thead><tr><th>من</th><th>إلى</th><th>السبب</th></tr></thead><tbody>{d.timeOff.map(t => <tr key={t.id}><td className="num small">{when(t.from)}</td><td className="num small">{when(t.to)}</td><td>{t.reason ?? '—'}</td></tr>)}</tbody></table> : <Empty text="لا إجازات" />}</div>
    </div>
  );
}

/** المحتوى: كتب ودورات المعلّم بحالاتها — فتح في المراجعة عند الانتظار، وأرشفة للمدير */
function ContentTab({ me, d }: { me: Me; d: TeacherAdminDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const archive = useMutation({ mutationFn: ({ type, id }: { type: 'book' | 'course'; id: number }) => api.post(`/admin/content/${type}/${id}/archive`), onSuccess: () => { toast('أُرشف'); qc.invalidateQueries({ queryKey: ['adm-teacher', d.id] }); qc.invalidateQueries({ queryKey: ['adm-content'] }); }, onError: e => toast(errMsg(e)) });
  const ask = async (type: 'book' | 'course', id: number, title: string) => { const r = await confirm({ title: `أرشفة «${title}»`, body: 'يختفي من المتجر ويبقى لمن اشتراه.', danger: true, confirmLabel: 'أرشفة' }); if (r) archive.mutate({ type, id }); };
  const rows = [...d.content.books.map(b => ({ ...b, type: 'book' as const })), ...d.content.courses.map(c => ({ ...c, type: 'course' as const }))];
  const admin = can(me, 'admin');
  return <div className="card">{rows.length ? <div className="tbl"><table><thead><tr><th>النوع</th><th>العنوان</th><th>الحالة</th><th>السعر</th><th>آخر تحديث</th><th /></tr></thead><tbody>{rows.map(r => <tr key={`${r.type}-${r.id}`}><td><Badge tone={r.type === 'book' ? 'info' : 'gold'}>{ar(r.type)}</Badge></td><td><b>{r.title}</b></td><td><Badge tone={STATUS_TONE[r.status]}>{ar(r.status)}</Badge></td><td className="num">{money(r.price)}</td><td className="num small">{when(r.updatedAt)}</td>
    <td className="actions">{r.status === 'pending_review' && can(me, 'content_reviewer') ? <Link className="btn secondary sm" to="/content?status=pending_review">فتح في المراجعة</Link> : null} {admin && r.status !== 'archived' ? <button className="btn ghost sm" disabled={archive.isPending} onClick={() => ask(r.type, r.id, r.title)}>أرشفة</button> : null}</td></tr>)}</tbody></table></div> : <Empty text="لا محتوى لهذا المعلّم" />}</div>;
}

/** صفحة المعلّم (Teacher 360): رأس بالإجراءات (قرار/تعديل للمدير) وعشرة تبويبات كل منها مسار */
export default function TeacherPage({ me }: { me: Me }) {
  const { id: idParam, tab = 'documents' } = useParams();
  const id = Number(idParam);
  const nav = useNavigate();
  const [drawer, setDrawer] = useState<'decision' | 'edit' | null>(null);
  const q = useQuery({ queryKey: ['adm-teacher', id], queryFn: () => api.get<TeacherAdminDetail>(`/admin/teachers/${id}`), enabled: Number.isInteger(id) && id > 0 });
  const reviews = useQuery({ queryKey: ['adm-reviews', 'teacher', id], queryFn: () => api.get<ReviewAdmin[]>(`/admin/teachers/${id}/reviews`), enabled: tab === 'reviews' && can(me, 'support') });
  const d = q.data;
  if (!d) return <Page title="صفحة المعلّم">{q.isError ? <ErrorState error={q.error} /> : <Empty text="جارٍ التحميل…" />}</Page>;
  const admin = can(me, 'admin'), fin = can(me, 'finance'), support = can(me, 'support');
  // بلا صلاحية عرض المستندات تصل القائمة فارغة، فحساب الشارة منها يعرض «صفر قيد المراجعة» ادّعاءً
  const pendingDocs = d.documentsVisible ? d.documents.filter(x => x.status === 'submitted').length : undefined;
  const tabs = [
    { key: 'documents', label: 'المستندات', badge: pendingDocs, show: true }, { key: 'teaching', label: 'التدريس', show: true }, { key: 'availability', label: 'التوفّر', show: true },
    { key: 'earnings', label: 'الأرباح', show: fin }, { key: 'payouts', label: 'السحوبات', show: fin },
    { key: 'bookings', label: 'الحجوزات', badge: d.stats.bookings.total, show: support || fin }, { key: 'reviews', label: 'التقييمات', badge: d.ratingCount, show: support },
    { key: 'students', label: 'الطلاب', badge: d.studentsCount, show: support }, { key: 'content', label: 'المحتوى', badge: d.content.books.length + d.content.courses.length, show: true }, { key: 'history', label: 'السجلّ', show: true },
  ].filter(t => t.show);
  const cur = tabs.some(t => t.key === tab) ? tab : 'documents';
  const b = d.stats.bookings;
  return (
    <Page title={d.name} sub={d.headline ?? `معلّم #${d.id}`} actions={<div className="acts">
      {admin ? <><button className="btn" onClick={() => setDrawer('decision')}>قرار التحقّق</button><button className="btn secondary" onClick={() => setDrawer('edit')}>تعديل</button></> : null}
      <Link className="btn ghost" to={`/users/${d.userId}`}>صفحة المستخدم</Link>
    </div>}>
      <div className="card phead">
        <Avatar url={d.avatarUrl} name={d.name} size={64} />
        <div className="info">
          <div className="row"><Badge tone={STATUS_TONE[d.status]}>{ar(d.status)}</Badge><Badge tone={STATUS_TONE[d.userStatus]}>الحساب: {ar(d.userStatus)}</Badge>{d.gender ? <Badge>{d.gender === 'female' ? 'معلّمة' : 'معلّم'}</Badge> : null}</div>
          <div className="meta">
            <span>التقييم <b className="num">{d.ratingCount ? `${d.ratingAvg.toFixed(1)} ★ · ${d.ratingCount}` : '—'}</b></span><span>الطلاب <b className="num">{d.studentsCount}</b></span><span>الحصص <b className="num">{d.lessonsCount}</b></span><span>العمولة <b className="num">{pct(d.commissionRate)}</b></span>
            <span>قدّم <b className="num">{day(d.appliedAt)}</b></span><span>اعتُمد <b className="num">{day(d.verifiedAt)}</b></span><span className="num">{d.phone ?? '—'} · {d.email ?? '—'}</span>
          </div>
        </div>
      </div>
      <Tabs tabs={tabs} value={cur} onChange={k => nav(`/teachers/${id}/${k}`)} />
      {cur === 'documents' ? <DocumentsTab me={me} d={d} /> : null}
      {cur === 'teaching' ? <TeachingTab d={d} /> : null}
      {cur === 'availability' ? <AvailabilityTab d={d} /> : null}
      {cur === 'earnings' ? <EarningsTab d={d} /> : null}
      {cur === 'payouts' ? <PayoutsTable params={{ teacherId: id }} initialStatus="all" hideTeacher /> : null}
      {cur === 'bookings' ? <><div className="kpis"><Kpi label="الكل" value={b.total} /><Kpi label="مكتملة" value={`${b.completed} · ${share(b.completed, b.total)}`} tone="ok" /><Kpi label="ألغاها المعلّم" value={`${b.cancelledByTeacher} · ${share(b.cancelledByTeacher, b.total)}`} tone={b.cancelledByTeacher ? 'danger' : undefined} /><Kpi label="لم تُحضَر" value={`${b.noShow} · ${share(b.noShow, b.total)}`} tone={b.noShow ? 'warn' : undefined} /><Kpi label="نزاعات" value={`${b.disputed} · ${share(b.disputed, b.total)}`} tone={b.disputed ? 'danger' : undefined} /><Kpi label="قادمة" value={b.upcoming} /></div><BookingsTable me={me} params={{ teacherId: id }} hideTeacher /></> : null}
      {cur === 'reviews' ? <div className="card"><div className="row" style={{ marginBottom: 10 }}><Badge>المتوسّط {d.stats.reviews.avg.toFixed(1)} ★</Badge><Badge>{d.stats.reviews.count} منشور</Badge><Badge tone={d.stats.reviews.hidden ? 'danger' : ''}>{d.stats.reviews.hidden} مخفي</Badge></div><ReviewsList rows={reviews.data} loading={reviews.isLoading} showTarget={false} onChanged={() => reviews.refetch()} /></div> : null}
      {cur === 'students' ? <StudentsTab teacherId={id} /> : null}
      {cur === 'content' ? <ContentTab me={me} d={d} /> : null}
      {cur === 'history' ? <><div className="card"><h2>سجلّ التحقّق</h2>{d.history.length ? <ul className="timeline">{d.history.map((h, i) => <li key={i}><span className="num small muted">{when(h.decided_at)}</span><span><Badge tone={STATUS_TONE[h.decision]}>{ar(h.decision)}</Badge> {h.reviewer ?? 'النظام'}{h.reason ? <div className="small muted">{h.reason}</div> : null}</span></li>)}</ul> : <Empty text="لا قرارات بعد" />}</div>{admin ? <><h3 style={{ marginTop: 18 }}>عمليات الطاقم على هذا الحساب</h3><AuditTable params={{ targetUserId: id }} /></> : null}</> : null}
      {drawer === 'decision' ? <DecisionDrawer d={d} onClose={() => setDrawer(null)} /> : null}
      {drawer === 'edit' ? <EditDrawer d={d} onClose={() => setDrawer(null)} /> : null}
      <p className="muted small" style={{ marginTop: 16 }}>صاحب الحساب: <PersonLink id={d.userId} name={d.name} /></p>
    </Page>
  );
}
