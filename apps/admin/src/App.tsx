import { useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, session } from './api';
import { useMe, can, isSuper, Field, errMsg, STAFF } from './ui';
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

/** الدخول برمز تحقّق — الحساب يجب أن يحمل دور طاقم */
function Login({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'target' | 'code'>('target');
  const [channel, setChannel] = useState<'phone' | 'email'>('phone');
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('');
  const [dev, setDev] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); setErr(null); try { const r = await api.post<{ target: string; devCode?: string }>('/auth/otp/request', { channel, target }); setTarget(r.target); setDev(r.devCode ?? null); setStep('code'); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const verify = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ accessToken: string; refreshToken: string; user: { roles: string[] } }>('/auth/otp/verify', { channel, target, code });
      if (!r.user.roles.some(x => STAFF.includes(x))) { setErr('هذا الحساب ليس من طاقم الإدارة'); return; }
      session.set(r.accessToken, r.refreshToken); onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="login"><div className="card">
      <div className="brand"><span className="mark">م</span>لوحة الإدارة</div>
      {step === 'target' ? (<>
        <div className="row" style={{ marginBottom: 12 }}><button className={`chip ${channel === 'phone' ? 'on' : ''}`} onClick={() => setChannel('phone')}>الهاتف</button><button className={`chip ${channel === 'email' ? 'on' : ''}`} onClick={() => setChannel('email')}>البريد</button></div>
        <Field label={channel === 'phone' ? 'رقم الهاتف' : 'البريد'}><input value={target} onChange={e => setTarget(e.target.value)} placeholder={channel === 'phone' ? '9XXXXXXX' : 'name@example.com'} onKeyDown={e => e.key === 'Enter' && send()} autoFocus /></Field>
        <button className="btn" onClick={send} disabled={busy || target.length < 5} style={{ width: '100%', justifyContent: 'center' }}>أرسل رمز التحقّق</button>
      </>) : (<>
        <p className="muted">أرسلنا رمزاً إلى <b className="num">{target}</b>{dev ? <span className="small"> — وضع التطوير: {dev}</span> : null}</p>
        <Field label="الرمز"><input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" onKeyDown={e => e.key === 'Enter' && verify()} autoFocus /></Field>
        <button className="btn" onClick={verify} disabled={busy || code.length < 6} style={{ width: '100%', justifyContent: 'center' }}>دخول</button>
        <button className="btn ghost" onClick={() => setStep('target')} style={{ marginTop: 8 }}>تغيير</button>
      </>)}
      {err ? <p className="error">{err}</p> : null}
    </div></div>
  );
}

export default function App() {
  const qc = useQueryClient();
  const me = useMe();
  const nav = useNavigate();
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<any>('/admin/overview'), enabled: !!me.data, refetchInterval: 60_000 });
  if (!session.refresh || (me.isError)) return <Login onDone={() => { qc.invalidateQueries(); nav('/'); }} />;
  if (me.isLoading || !me.data) return <div className="empty">جارٍ التحميل…</div>;
  const u = me.data; const q = overview.data?.queues ?? {};
  const item = (to: string, label: string, ok: boolean, count?: number) => ok ? <NavLink to={to} end={to === '/'}>{label}{count ? <span className="count">{count}</span> : null}</NavLink> : null;
  return (
    <div className="layout">
      <aside className="side">
        <div className="brand"><span className="mark">م</span>لوحة الإدارة</div>
        {item('/', 'نظرة عامة', true)}
        {item('/teachers', 'المعلّمون', can(u, 'support'), q.teacherApplications)}
        {item('/content', 'مراجعة المحتوى', can(u, 'content_reviewer'), q.contentReview)}
        {item('/bookings', 'الحجوزات', can(u, 'support', 'finance'))}
        {item('/orders', 'الطلبات والاسترجاع', can(u, 'finance', 'support'), q.manualPayments)}
        {item('/payouts', 'سحوبات المعلّمين', can(u, 'finance'), q.payouts)}
        {item('/coupons', 'الكوبونات', can(u, 'finance'))}
        {item('/catalog', 'المنهج', can(u, 'admin', 'content_reviewer'))}
        {item('/users', 'المستخدمون', can(u, 'support'))}
        {item('/reports', 'البلاغات', can(u, 'support'), q.reports)}
        {item('/settings', 'الإعدادات والسياسات', can(u, 'finance', 'support'))}
        {item('/audit', 'سجلّ العمليات', can(u, 'admin'))}
        <div className="user">{u.displayName}<br /><span>{u.roles.map(r => r).join(' · ')}</span><br /><button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => { api.post('/auth/logout', { refreshToken: session.refresh }).catch(() => {}); session.set(null, null); qc.clear(); nav('/'); }}>تسجيل الخروج</button></div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/teachers" element={<Teachers me={u} />} />
          <Route path="/content" element={<Content />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/orders" element={<Orders me={u} />} />
          <Route path="/payouts" element={<Payouts />} />
          <Route path="/coupons" element={<Coupons />} />
          <Route path="/catalog" element={<Catalog me={u} />} />
          <Route path="/users" element={<Users me={u} isSuper={isSuper(u)} />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings me={u} />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
