import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PersonDetail, ProfilePatch } from '@manassah/shared';
import { api, money, when, day } from '../api';
import { Page, Empty, ErrorState, Badge, Tabs, Drawer, Field, Avatar, LearnerChip, TeacherLink, STAFF, STATUS_TONE, ar, useToast, errMsg, useConfirm, can, isSuper, type Me } from '../ui';
import { ProfileTab } from './person/ProfileTab';
import { RolesTab } from './person/RolesTab';
import { WalletTab } from './person/WalletTab';
import { BookingsTab } from './person/BookingsTab';
import { EntitlementsTab } from './person/EntitlementsTab';
import { ReviewsTab } from './person/ReviewsTab';
import { SessionsTab } from './person/SessionsTab';
import { OrdersTable } from './parts/OrdersTable';
import { ReportsTable } from './parts/ReportsTable';
import { AuditTable } from './parts/AuditTable';

/** نموذج تعديل بيانات الحساب (للمدير) — يُرسل الحقول المتغيّرة فقط */
function ProfileDrawer({ d, onClose }: { d: PersonDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ displayName: d.profile.displayName, phone: d.phone ?? '', email: d.email ?? '', locale: d.locale, timezone: d.timezone, gender: d.profile.gender ?? '' });
  const save = useMutation({
    mutationFn: () => {
      const b: ProfilePatch = {};
      if (f.displayName.trim() !== d.profile.displayName) b.displayName = f.displayName.trim();
      if ((f.phone.trim() || null) !== d.phone) b.phone = f.phone.trim() || null;
      if ((f.email.trim() || null) !== d.email) b.email = f.email.trim() || null;
      if (f.locale !== d.locale) b.locale = f.locale as 'ar' | 'en';
      if (f.timezone.trim() !== d.timezone) b.timezone = f.timezone.trim();
      if ((f.gender || null) !== d.profile.gender) b.gender = f.gender ? (f.gender as 'male' | 'female') : null;
      return api.patch<PersonDetail>(`/admin/users/${d.id}/profile`, b);
    },
    onSuccess: r => { toast('حُفظت البيانات'); qc.setQueryData(['adm-user', d.id], r); qc.invalidateQueries({ queryKey: ['adm-users'] }); onClose(); }, onError: e => toast(errMsg(e)),
  });
  return (
    <Drawer title="تعديل البيانات" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>إلغاء</button><button className="btn" disabled={save.isPending || f.displayName.trim().length < 2 || (!f.phone.trim() && !f.email.trim())} onClick={() => save.mutate()}>حفظ</button></>}>
      <Field label="الاسم"><input value={f.displayName} onChange={e => setF(s => ({ ...s, displayName: e.target.value }))} /></Field>
      <Field label="الهاتف (بصيغة دولية +968…)" hint="يجب أن يبقى هاتف أو بريد واحد على الأقل"><input value={f.phone} className="mono" onChange={e => setF(s => ({ ...s, phone: e.target.value }))} /></Field>
      <Field label="البريد"><input value={f.email} className="mono" onChange={e => setF(s => ({ ...s, email: e.target.value }))} /></Field>
      <div className="grid grid-2">
        <Field label="اللغة"><select value={f.locale} onChange={e => setF(s => ({ ...s, locale: e.target.value }))}><option value="ar">العربية</option><option value="en">English</option></select></Field>
        <Field label="الجنس"><select value={f.gender} onChange={e => setF(s => ({ ...s, gender: e.target.value }))}><option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option></select></Field>
      </div>
      <Field label="المنطقة الزمنية"><input value={f.timezone} className="mono" onChange={e => setF(s => ({ ...s, timezone: e.target.value }))} /></Field>
    </Drawer>
  );
}

/** صفحة الشخص (Person 360): الرأس بالإجراءات المقيَّدة بالدور، وعشرة تبويبات كل منها مسار */
export default function Person({ me }: { me: Me }) {
  const { id: idParam, tab = 'profile' } = useParams();
  const id = Number(idParam);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['adm-user', id], queryFn: () => api.get<PersonDetail>(`/admin/users/${id}`), enabled: Number.isInteger(id) && id > 0 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['adm-user', id] }); qc.invalidateQueries({ queryKey: ['adm-users'] }); };
  const setStatus = useMutation({ mutationFn: (b: { status: string; reason?: string }) => api.post<PersonDetail>(`/admin/users/${id}/status`, b), onSuccess: r => { toast('تم'); qc.setQueryData(['adm-user', id], r); refresh(); }, onError: e => toast(errMsg(e)) });
  const revoke = useMutation({ mutationFn: (deviceTokens: boolean) => api.post(`/admin/users/${id}/sessions/revoke`, { deviceTokens }), onSuccess: () => { toast('أُنهيت الجلسات'); refresh(); qc.invalidateQueries({ queryKey: ['adm-sessions', id] }); }, onError: e => toast(errMsg(e)) });
  const d = q.data;
  if (!d) return <Page title="صفحة الشخص">{q.isError ? <ErrorState error={q.error} /> : <Empty text="جارٍ التحميل…" />}</Page>;
  const name = d.profile.displayName || `#${d.id}`;
  const admin = can(me, 'admin'), support = can(me, 'support'), fin = can(me, 'finance');
  // حسابات الطاقم يديرها super_admin وحده في الخادم (requireSuperForStaffTarget) — فلا تُعرض الأزرار لغيره
  const staffTarget = d.roles.some(r => STAFF.includes(r.role));
  const manage = !staffTarget || isSuper(me);
  const isTeacher = d.roles.some(r => r.role === 'teacher');
  const active = d.learners.find(l => l.id === d.activeLearnerId) ?? null;
  const suspend = async () => { const r = await confirm({ title: `إيقاف ${name}`, body: 'تُنهى جلساته فوراً ويُمنع من الدخول حتى التفعيل.', reasonRequired: true, danger: true, confirmLabel: 'إيقاف' }); if (r) setStatus.mutate({ status: 'suspended', reason: r.reason }); };
  const activate = async () => { const r = await confirm({ title: `تفعيل ${name}`, body: 'يعود الحساب نشطاً ويُمسح سبب الإيقاف.', confirmLabel: 'تفعيل' }); if (r) setStatus.mutate({ status: 'active' }); };
  const del = async () => { const r = await confirm({ title: `حذف حساب ${name}`, body: 'حذف نهائي: تُمسح بيانات التواصل والاسم والمتعلّمون وتُنهى الجلسات. لا رجوع.', reasonRequired: true, typed: String(d.id), danger: true, confirmLabel: 'حذف الحساب' }); if (r) setStatus.mutate({ status: 'deleted', reason: r.reason }); };
  const endSessions = async () => { const r = await confirm({ title: 'إنهاء كل الجلسات', body: 'يخرج المستخدم من كل أجهزته فوراً.', fields: [{ key: 'dt', label: 'رموز الإشعارات', type: 'checkbox', initial: 'true', placeholder: 'حذف رموز الإشعارات أيضاً' }], danger: true, confirmLabel: 'إنهاء' }); if (r) revoke.mutate(r.dt === 'true'); };
  const tabs = [
    { key: 'profile', label: 'الملف', show: true }, { key: 'roles', label: 'الأدوار', show: true },
    { key: 'wallet', label: 'المحفظة', show: fin || support }, { key: 'orders', label: 'الطلبات', badge: d.counts.orders, show: fin || support },
    { key: 'bookings', label: 'الحجوزات', badge: d.counts.bookings, show: support || fin }, { key: 'entitlements', label: 'الامتلاك', badge: d.counts.entitlements, show: support || fin },
    { key: 'reviews', label: 'التقييمات', badge: d.counts.reviews, show: support }, { key: 'reports', label: 'البلاغات', badge: d.counts.reportsFiled + d.counts.reportsAgainst, show: support },
    { key: 'sessions', label: 'الجلسات', badge: d.counts.activeSessions, show: support }, { key: 'audit', label: 'السجلّ', show: admin },
  ].filter(t => t.show);
  const cur = tabs.some(t => t.key === tab) ? tab : 'profile';
  const statusTitle = d.status === 'suspended' ? `${d.statusReason ?? ''} · ${when(d.suspendedAt)}${d.suspendedBy ? ` · بواسطة ${d.suspendedBy.name}` : ''}` : d.statusReason ?? undefined;
  const p = { me, d, id };
  return (
    <Page title={name} sub={`مستخدم #${d.id}`} actions={<div className="acts">
      {admin && manage ? <button className="btn secondary" onClick={() => setEdit(true)}>تعديل البيانات</button> : null}
      {admin && manage && d.id !== me.id && d.status !== 'deleted' ? (d.status === 'active' ? <button className="btn danger" onClick={suspend}>إيقاف</button> : <button className="btn success" onClick={activate}>تفعيل</button>) : null}
      {isSuper(me) && d.id !== me.id && d.status !== 'deleted' ? <button className="btn danger" onClick={del}>حذف الحساب</button> : null}
      {support && manage ? <button className="btn secondary" onClick={endSessions}>إنهاء الجلسات</button> : null}
      {staffTarget && !isSuper(me) ? <span className="badge info" title="حسابات الطاقم يديرها المدير العام">حساب طاقم — للمدير العام</span> : null}
      {d.teacher ? <Link className="btn ghost" to={`/teachers/${d.id}`}>صفحة المعلّم</Link> : null}
    </div>}>
      <div className="card phead">
        <Avatar url={d.profile.avatarUrl} name={name} size={64} />
        <div className="info">
          <div className="row"><Badge tone={STATUS_TONE[d.status]} title={statusTitle}>{ar(d.status)}</Badge>{d.roles.map(r => <Badge key={r.role} tone={['admin', 'super_admin'].includes(r.role) ? 'brand' : r.role === 'teacher' ? 'gold' : STAFF.includes(r.role) ? 'info' : ''}>{ar(r.role)}</Badge>)}{d.teacher ? <TeacherLink id={d.id} name={`معلّم ${ar(d.teacher.status)}`} /> : null}</div>
          {d.status === 'suspended' ? <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>موقوف: {d.statusReason ?? '—'} · {when(d.suspendedAt)}{d.suspendedBy ? <> · بواسطة <Link to={`/users/${d.suspendedBy.id}`}>{d.suspendedBy.name}</Link></> : null}</div> : null}
          <div className="meta">
            <span className="num">{d.phone ?? '—'}</span><span className="num">{d.email ?? '—'}</span>
            <span>أُنشئ <b className="num">{day(d.createdAt)}</b></span><span>آخر دخول <b className="num">{when(d.lastLoginAt)}</b></span>
            <span>المتعلّمون <b className="num">{d.learners.filter(l => !l.archivedAt).length}</b></span><span>المحفظة <b className="num">{money(d.wallet.balance)}</b></span>
            {active ? <span>النشط: <LearnerChip learner={active} /></span> : null}
          </div>
        </div>
      </div>
      <Tabs tabs={tabs} value={cur} onChange={k => nav(`/users/${id}/${k}`)} />
      {cur === 'profile' ? <ProfileTab {...p} /> : null}
      {cur === 'roles' ? <RolesTab {...p} /> : null}
      {cur === 'wallet' ? <WalletTab {...p} /> : null}
      {cur === 'orders' ? <OrdersTable me={me} params={{ userId: id }} hideCustomer /> : null}
      {cur === 'bookings' ? <BookingsTab {...p} /> : null}
      {cur === 'entitlements' ? <EntitlementsTab {...p} /> : null}
      {cur === 'reviews' ? <ReviewsTab {...p} /> : null}
      {cur === 'sessions' ? <SessionsTab {...p} /> : null}
      {cur === 'reports' ? <><h3>بلاغات قدّمها</h3><ReportsTable params={{ reporterId: id }} initialStatus="all" hideReporter /><h3 style={{ marginTop: 18 }}>بلاغات ضدّه</h3><ReportsTable params={{ targetType: 'user', targetId: id }} initialStatus="all" /></> : null}
      {cur === 'audit' ? <AuditTabInner id={id} /> : null}
      {edit ? <ProfileDrawer d={d} onClose={() => setEdit(false)} /> : null}
    </Page>
  );
}

/** السجلّ: ما نُفّذ على هذا الحساب، أو ما نفّذه هو (للطاقم) */
function AuditTabInner({ id }: { id: number }) {
  const [asActor, setAsActor] = useState(false);
  return <><div className="toolbar"><button className={`chip ${!asActor ? 'on' : ''}`} onClick={() => setAsActor(false)}>كمستهدَف</button><button className={`chip ${asActor ? 'on' : ''}`} onClick={() => setAsActor(true)}>كمنفّذ</button></div><AuditTable key={String(asActor)} params={asActor ? { actorId: id } : { targetUserId: id }} /></>;
}
