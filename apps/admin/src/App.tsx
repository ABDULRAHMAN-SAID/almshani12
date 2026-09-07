import { useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, session } from './api';
import type { Overview as OverviewT, AuthMethods, OtpVia, OtpDelivery, OtpRequestResult } from '@manassah/shared';
import { useMe, can, Field, errMsg, STAFF, NoAccess, Page } from './ui';
import Overview from './pages/Overview';
import Teachers from './pages/Teachers';
import Content from './pages/Content';
import Bookings from './pages/Bookings';
import Orders from './pages/Orders';
import Payouts from './pages/Payouts';
import Settings from './pages/Settings';
import Catalog from './pages/Catalog';
import Coupons from './pages/Coupons';
import Users from './pages/Users';
import Reports from './pages/Reports';
import Audit from './pages/Audit';
import Person from './pages/Person';
import TeacherPage from './pages/Teacher';
import System from './pages/System';

/** ما يُفترض قبل معرفة طرق الخادم (أثناء التحميل أو عند تعذّر الجلب) */
const METHODS_FALLBACK: AuthMethods = { phone: true, whatsapp: false, email: true, testCode: true, google: false, apple: false };
const SENT: Record<OtpDelivery, string> = { sms: 'أرسلنا رسالة نصية إلى', whatsapp: 'أرسلنا رسالة واتساب إلى', email: 'أرسلنا بريداً إلى', test: 'حساب تجريبي — رمز ثابت لـ' };

/** الدخول برمز تحقّق — الحساب يجب أن يحمل دور طاقم */
function Login({ onDone }: { onDone: () => void }) {
  const methodsQ = useQuery({ queryKey: ['auth-methods'], queryFn: () => api.get<AuthMethods>('/auth/methods'), staleTime: 5 * 60_000, retry: 1 });
  const methods = methodsQ.data ?? METHODS_FALLBACK;
  const [step, setStep] = useState<'target' | 'code'>('target');
  const [channel, setChannel] = useState<'phone' | 'email'>('phone');
  const [via, setVia] = useState<OtpVia>('sms');
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('');
  const [dev, setDev] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<OtpDelivery>('sms');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // قناة واحدة فقط متاحة → تُختار تلقائياً ولا شرائح
  const enabled = (['phone', 'email'] as const).filter(ch => methods[ch]);
  const single = enabled.length === 1 ? enabled[0] : null;
  useEffect(() => { if (single && channel !== single) { setChannel(single); setTarget(''); setErr(null); } }, [single, channel]);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<OtpRequestResult>('/auth/otp/request', channel === 'phone' ? { channel, target, via } : { channel, target });
      setTarget(r.target); setDev(r.devCode ?? null); setDelivery(r.delivery); setStep('code');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ accessToken: string; refreshToken: string; user: { roles: string[] } }>('/auth/otp/verify', { channel, target, code });
      if (!r.user.roles.some(x => STAFF.includes(x))) { setErr('هذا الحساب ليس من طاقم الإدارة'); return; }
      session.set(r.accessToken, r.refreshToken); onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const pick = (ch: 'phone' | 'email') => { setChannel(ch); setTarget(''); setErr(null); };
  return (
    <div className="login"><div className="card">
      <div className="brand"><span className="mark">م</span>لوحة الإدارة</div>
      {step === 'target' && enabled.length === 0 ? (
        // الخادم لم يفعّل أي طريقة دخول بعد (لا مزوّد ولا رمز ثابت)
        <p className="muted">الدخول بالهاتف أو البريد غير متاح على هذا الخادم بعد — اضبط مزوّد رموز التحقّق (راجع README).</p>
      ) : step === 'target' ? (<>
        {enabled.length > 1 ? <div className="row" style={{ marginBottom: 12 }}>
          {methods.phone ? <button className={`chip ${channel === 'phone' ? 'on' : ''}`} onClick={() => pick('phone')}>الهاتف</button> : null}
          {methods.email ? <button className={`chip ${channel === 'email' ? 'on' : ''}`} onClick={() => pick('email')}>البريد</button> : null}
        </div> : null}
        <Field label={channel === 'phone' ? 'رقم الهاتف' : 'البريد'}><input value={target} onChange={e => setTarget(e.target.value)} placeholder={channel === 'phone' ? '9XXXXXXX' : 'name@example.com'} onKeyDown={e => e.key === 'Enter' && send()} autoFocus /></Field>
        {channel === 'phone' && methods.whatsapp ? <div className="row" style={{ marginBottom: 12 }}>
          <span className="muted small">أرسل الرمز عبر</span>
          <button className={`chip ${via === 'sms' ? 'on' : ''}`} onClick={() => setVia('sms')}>رسالة نصية</button>
          <button className={`chip ${via === 'whatsapp' ? 'on' : ''}`} onClick={() => setVia('whatsapp')}>واتساب</button>
        </div> : null}
        <button className="btn" onClick={send} disabled={busy || target.length < 5} style={{ width: '100%', justifyContent: 'center' }}>أرسل رمز التحقّق</button>
      </>) : (<>
        <p className="muted">{SENT[delivery]} <b className="num">{target}</b>{dev ? <span className="small"> — {delivery === 'test' ? 'رمز الحساب التجريبي' : 'وضع التطوير'}: <b className="num">{dev}</b></span> : null}</p>
        {delivery === 'email' ? <p className="muted small">لم تصلك؟ تحقّق من مجلد الرسائل غير المرغوبة</p> : null}
        <Field label="الرمز"><input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" onKeyDown={e => e.key === 'Enter' && verify()} autoFocus /></Field>
        <button className="btn" onClick={verify} disabled={busy || code.length < 6} style={{ width: '100%', justifyContent: 'center' }}>دخول</button>
        <button className="btn ghost" onClick={() => { setStep('target'); setCode(''); setErr(null); }} style={{ marginTop: 8 }}>تغيير</button>
      </>)}
      {err ? <p className="error">{err}</p> : null}
    </div></div>
  );
}

export default function App() {
  const qc = useQueryClient();
  const me = useMe();
  const nav = useNavigate();
  // شارات الشريط الجانبي من النظرة الحيّة نفسها (المفتاح ['overview', 14] يشاركه Overview)
  const overview = useQuery({ queryKey: ['overview', 14], queryFn: () => api.get<OverviewT>('/admin/overview', { days: 14 }), enabled: !!me.data, refetchInterval: 60_000 });
  if (!session.refresh || (me.isError)) return <Login onDone={() => { qc.invalidateQueries(); nav('/'); }} />;
  if (me.isLoading || !me.data) return <div className="empty">جارٍ التحميل…</div>;
  const u = me.data; const q: Partial<OverviewT['queues']> = overview.data?.queues ?? {};
  const item = (to: string, label: string, ok: boolean, count?: number) => ok ? <NavLink to={to} end={to === '/'}>{label}{count ? <span className="count">{count}</span> : null}</NavLink> : null;
  /** حارس الدور: القسم الممنوع يعرض «لا تملك صلاحية» بدل قائمة فارغة أو 403 صامت */
  const guard = (title: string, ok: boolean, el: ReactNode) => ok ? el : <Page title={title}><NoAccess /></Page>;
  return (
    <div className="layout">
      <aside className="side">
        <div className="brand"><span className="mark">م</span>لوحة الإدارة</div>
        {item('/', 'نظرة عامة', true)}
        {item('/teachers', 'المعلّمون', can(u, 'support'), (q.teacherApplications ?? 0) + (q.pendingDocuments ?? 0))}
        {item('/content', 'مراجعة المحتوى', can(u, 'content_reviewer'), q.contentReview)}
        {item('/bookings', 'الحجوزات', can(u, 'support', 'finance'), q.disputes)}
        {item('/orders', 'الطلبات والاسترجاع', can(u, 'finance', 'support'), q.manualPayments)}
        {item('/payouts', 'سحوبات المعلّمين', can(u, 'finance'), q.payouts)}
        {item('/coupons', 'الكوبونات', can(u, 'finance'))}
        {item('/catalog', 'المنهج', can(u, 'admin', 'content_reviewer'))}
        {item('/users', 'المستخدمون', can(u, 'support'))}
        {item('/reports', 'البلاغات', can(u, 'support'), q.reports)}
        {item('/settings', 'الإعدادات والسياسات', can(u, 'finance', 'support'))}
        {item('/system', 'الربط والخدمات', can(u, 'admin'))}
        {item('/audit', 'سجلّ العمليات', can(u, 'admin'))}
        <div className="user">{u.displayName}<br /><span>{u.roles.map(r => r).join(' · ')}</span><br /><button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => { api.post('/auth/logout', { refreshToken: session.refresh }).catch(() => {}); session.set(null, null); qc.clear(); nav('/'); }}>تسجيل الخروج</button></div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/teachers" element={guard('المعلّمون', can(u, 'support'), <Teachers me={u} />)} />
          <Route path="/teachers/:id" element={guard('المعلّم', can(u, 'support', 'finance'), <TeacherPage me={u} />)} />
          <Route path="/teachers/:id/:tab" element={guard('المعلّم', can(u, 'support', 'finance'), <TeacherPage me={u} />)} />
          <Route path="/content" element={guard('مراجعة المحتوى', can(u, 'content_reviewer'), <Content me={u} />)} />
          <Route path="/bookings" element={guard('الحجوزات', can(u, 'support', 'finance'), <Bookings me={u} />)} />
          <Route path="/orders" element={guard('الطلبات والاسترجاع', can(u, 'finance', 'support'), <Orders me={u} />)} />
          <Route path="/payouts" element={guard('سحوبات المعلّمين', can(u, 'finance'), <Payouts />)} />
          <Route path="/coupons" element={guard('الكوبونات', can(u, 'finance'), <Coupons />)} />
          <Route path="/catalog" element={guard('المنهج', can(u, 'admin', 'content_reviewer'), <Catalog me={u} />)} />
          <Route path="/users" element={guard('المستخدمون', can(u, 'support'), <Users me={u} />)} />
          <Route path="/users/:id" element={guard('صفحة الشخص', can(u, 'support', 'finance'), <Person me={u} />)} />
          <Route path="/users/:id/:tab" element={guard('صفحة الشخص', can(u, 'support', 'finance'), <Person me={u} />)} />
          <Route path="/reports" element={guard('البلاغات', can(u, 'support'), <Reports />)} />
          <Route path="/settings" element={guard('الإعدادات والسياسات', can(u, 'finance', 'support'), <Settings me={u} />)} />
          <Route path="/system" element={guard('الربط والخدمات', can(u, 'admin'), <System />)} />
          <Route path="/audit" element={guard('سجلّ العمليات', can(u, 'admin'), <Audit />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
