import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, when } from '../api';
import { SummaryChips } from './System';
import { Page, Field, ErrorState, useToast, errMsg, fieldErrors, can, type Me } from '../ui';
import type { SystemInfo } from '@manassah/shared';

type Policy = { hoursBefore: number; refundPercent: number }[];
/** رقم صالح أو null — الفراغ لا يصير صفراً و«abc» لا يصير NaN ثم null في JSON */
const numOf = (v: string | undefined) => { const t = (v ?? '').trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const clampInt = (v: string, max: number) => Math.min(max, Math.max(0, Math.trunc(Number(v) || 0)));
/** أخطاء سياسة الإلغاء: ساعات مكرّرة تجعل القاعدة المطبَّقة ملتبسة، وقاعدة الصفر هي الحدّ الأدنى */
function policyError(p: Policy): string | null {
  if (!p.length) return 'أضِف قاعدة واحدة على الأقل';
  const dup = [...new Set(p.filter((r, i) => p.findIndex(x => x.hoursBefore === r.hoursBefore) !== i).map(r => r.hoursBefore))];
  if (dup.length) return `ساعات مكرّرة في أكثر من قاعدة: ${dup.join('، ')}`;
  if (!p.some(r => r.hoursBefore === 0)) return 'أضِف قاعدة بصفر ساعات كحدّ أدنى';
  return null;
}
const NUM: [string, string, string][] = [
  ['commission_rate', 'عمولة المنصّة (نسبة من 0 إلى 0.9)', 'مثال 0.20 = ٢٠٪'], ['tax_rate', 'الضريبة (نسبة)', '0 = لا ضريبة'], ['min_payout', 'الحدّ الأدنى للسحب (ر.ع)', ''],
  ['room_open_minutes_before', 'فتح القاعة قبل الموعد (دقائق)', ''], ['room_close_minutes_after', 'إغلاق القاعة بعد النهاية (دقائق)', ''], ['booking_payment_window_minutes', 'مهلة دفع الحجز (دقائق)', 'يتحرّر الموعد بعدها'],
  ['earnings_hold_hours', 'احتجاز أرباح الكتب/الدورات (ساعات)', 'نافذة الاسترجاع'], ['max_teacher_slots_per_day', 'أقصى حصص للمعلّم يومياً', ''],
];

/** ملخّص سطرين لحالة الربط — التفاصيل والفحص في صفحة «الربط والخدمات» */
function SystemSummary() {
  const q = useQuery({ queryKey: ['adm-system'], queryFn: () => api.get<SystemInfo>('/admin/system'), staleTime: 60_000 });
  const s = q.data;
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>الربط والخدمات</h2><Link className="btn secondary sm" to="/system">التفاصيل والفحص</Link></div>
      {q.isLoading ? <p className="muted" style={{ margin: '10px 0 0' }}>جارٍ التحميل…</p> : q.isError || !s ? <p className="error">{errMsg(q.error)}</p> : (<>
        <div style={{ marginTop: 10 }}><SummaryChips s={s.summary} /></div>
        <p className="muted small" style={{ margin: '8px 0 0' }}>الدفع: {s.payments.providers.join('، ') || '—'} · الغرف: {s.rooms.provider} · آخر نسخة احتياطية: {when(s.backups.last)}</p>
      </>)}
    </div>
  );
}

/** السياسات تُدار من هنا لا من الشيفرة: سياسة الإلغاء، العمولة، المهل… — التعديل للمدير فقط */
export default function Settings({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['adm-settings'], queryFn: () => api.get<Record<string, unknown>>('/admin/settings') });
  const [form, setForm] = useState<Record<string, string>>({});
  const [policy, setPolicy] = useState<Policy>([]);
  const [reminders, setReminders] = useState('');
  useEffect(() => { if (!q.data) return; const f: Record<string, string> = {}; for (const [k] of NUM) f[k] = String(q.data[k] ?? ''); setForm(f); setPolicy((q.data.cancellation_policy as Policy) ?? []); setReminders(((q.data.reminder_minutes as number[]) ?? []).join(', ')); }, [q.data]);
  const save = useMutation({
    // لا تُرسَل إلّا الحقول التي قرأناها كأرقام — الحقل الفارغ لا يُحفظ صفراً
    mutationFn: () => api.put('/admin/settings', {
      ...Object.fromEntries(NUM.map(([k]) => [k, numOf(form[k])]).filter(([, v]) => v !== null)),
      cancellation_policy: [...policy].sort((a, b) => b.hoursBefore - a.hoursBefore),
      reminder_minutes: reminders.split(',').map(x => numOf(x)).filter((n): n is number => n !== null && n > 0),
    }),
    onSuccess: () => { toast('حُفظت الإعدادات'); qc.invalidateQueries({ queryKey: ['adm-settings'] }); }, onError: e => toast(errMsg(e)),
  });
  const admin = can(me, 'admin');
  // تحقّق قبل الإرسال + تفاصيل ٤٢٢ من الخادم، كلاهما يظهر تحت الحقل نفسه
  const loaded = !!q.data;
  const srv = fieldErrors(save.error);
  const errs: Record<string, string> = { ...srv };
  if (loaded) for (const [k] of NUM) { const t = (form[k] ?? '').trim(); if (!t) errs[k] ??= 'لا تتركه فارغاً'; else if (numOf(t) === null) errs[k] ??= 'أدخل رقماً'; }
  const polErr = (loaded ? policyError(policy) : null) ?? srv.cancellation_policy ?? null;
  const remErr = reminders.split(',').some(x => x.trim() && numOf(x) === null) ? 'أرقام دقائق مفصولة بفاصلة' : srv.reminder_minutes ?? null;
  const blocked = !loaded || NUM.some(([k]) => !!errs[k]) || !!polErr || !!remErr;
  return (
    <Page title="الإعدادات والسياسات" sub="تسري فوراً على كل الحجوزات والطلبات الجديدة" actions={admin ? <button className="btn" disabled={save.isPending || blocked} onClick={() => save.mutate()}>حفظ</button> : <span className="badge">قراءة فقط</span>}>
      {q.isError ? <ErrorState error={q.error} /> : null}
      <div className="grid grid-2">
        <div className="card">
          <h2>سياسة الإلغاء</h2>
          <p className="muted small">«قبل X ساعة أو أكثر من الموعد يُسترجع Y٪». القاعدة بصفر ساعات هي الحدّ الأدنى. إلغاء المعلّم يُسترجع ١٠٠٪ دائماً.</p>
          <table><thead><tr><th>قبل (ساعة)</th><th>الاسترجاع ٪</th><th></th></tr></thead><tbody>
            {policy.map((r, i) => <tr key={i}><td><input type="number" min={0} value={r.hoursBefore} disabled={!admin} onChange={e => setPolicy(p => p.map((x, j) => j === i ? { ...x, hoursBefore: clampInt(e.target.value, 720) } : x))} /></td><td><input type="number" min={0} max={100} value={r.refundPercent} disabled={!admin} onChange={e => setPolicy(p => p.map((x, j) => j === i ? { ...x, refundPercent: clampInt(e.target.value, 100) } : x))} /></td><td className="actions">{admin ? <button className="btn ghost sm" onClick={() => setPolicy(p => p.filter((_, j) => j !== i))}>حذف</button> : null}</td></tr>)}
          </tbody></table>
          {polErr ? <p className="error" style={{ margin: '8px 0 0' }}>{polErr}</p> : null}
          {admin ? <button className="btn secondary sm" style={{ marginTop: 10 }} onClick={() => setPolicy(p => [...p, { hoursBefore: Math.max(0, ...p.map(r => r.hoursBefore)) + 1, refundPercent: 0 }])}>إضافة قاعدة</button> : null}
        </div>
        <div className="card">
          <h2>الأرقام</h2>
          {NUM.map(([k, label, hint]) => <Field key={k} label={hint ? `${label} — ${hint}` : label} error={errs[k]}><input value={form[k] ?? ''} disabled={!admin} inputMode="decimal" onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} /></Field>)}
          <Field label="تذكيرات الحصص (دقائق قبل الموعد، مفصولة بفاصلة)" error={remErr}><input value={reminders} disabled={!admin} onChange={e => setReminders(e.target.value)} /></Field>
        </div>
        {admin ? <SystemSummary /> : null}
      </div>
    </Page>
  );
}
