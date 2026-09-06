import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Page, Field, useToast, errMsg, can, type Me } from '../ui';

type Policy = { hoursBefore: number; refundPercent: number }[];
const NUM: [string, string, string][] = [
  ['commission_rate', 'عمولة المنصّة (نسبة من 0 إلى 0.9)', 'مثال 0.20 = ٢٠٪'], ['tax_rate', 'الضريبة (نسبة)', '0 = لا ضريبة'], ['min_payout', 'الحدّ الأدنى للسحب (ر.ع)', ''],
  ['room_open_minutes_before', 'فتح القاعة قبل الموعد (دقائق)', ''], ['room_close_minutes_after', 'إغلاق القاعة بعد النهاية (دقائق)', ''], ['booking_payment_window_minutes', 'مهلة دفع الحجز (دقائق)', 'يتحرّر الموعد بعدها'],
  ['earnings_hold_hours', 'احتجاز أرباح الكتب/الدورات (ساعات)', 'نافذة الاسترجاع'], ['max_teacher_slots_per_day', 'أقصى حصص للمعلّم يومياً', ''],
];

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
    mutationFn: () => api.put('/admin/settings', { ...Object.fromEntries(NUM.map(([k]) => [k, Number(form[k])])), cancellation_policy: [...policy].sort((a, b) => b.hoursBefore - a.hoursBefore), reminder_minutes: reminders.split(',').map(s => Number(s.trim())).filter(n => n > 0) }),
    onSuccess: () => { toast('حُفظت الإعدادات'); qc.invalidateQueries({ queryKey: ['adm-settings'] }); }, onError: e => toast(errMsg(e)),
  });
  const admin = can(me, 'admin');
  return (
    <Page title="الإعدادات والسياسات" sub="تسري فوراً على كل الحجوزات والطلبات الجديدة" actions={admin ? <button className="btn" disabled={save.isPending} onClick={() => save.mutate()}>حفظ</button> : <span className="badge">قراءة فقط</span>}>
      <div className="grid grid-2">
        <div className="card">
          <h2>سياسة الإلغاء</h2>
          <p className="muted small">«قبل X ساعة أو أكثر من الموعد يُسترجع Y٪». القاعدة بصفر ساعات هي الحدّ الأدنى. إلغاء المعلّم يُسترجع ١٠٠٪ دائماً.</p>
          <table><thead><tr><th>قبل (ساعة)</th><th>الاسترجاع ٪</th><th></th></tr></thead><tbody>
            {policy.map((r, i) => <tr key={i}><td><input type="number" min={0} value={r.hoursBefore} disabled={!admin} onChange={e => setPolicy(p => p.map((x, j) => j === i ? { ...x, hoursBefore: Number(e.target.value) } : x))} /></td><td><input type="number" min={0} max={100} value={r.refundPercent} disabled={!admin} onChange={e => setPolicy(p => p.map((x, j) => j === i ? { ...x, refundPercent: Number(e.target.value) } : x))} /></td><td className="actions">{admin ? <button className="btn ghost sm" onClick={() => setPolicy(p => p.filter((_, j) => j !== i))}>حذف</button> : null}</td></tr>)}
          </tbody></table>
          {admin ? <button className="btn secondary sm" style={{ marginTop: 10 }} onClick={() => setPolicy(p => [...p, { hoursBefore: 0, refundPercent: 0 }])}>إضافة قاعدة</button> : null}
        </div>
        <div className="card">
          <h2>الأرقام</h2>
          {NUM.map(([k, label, hint]) => <Field key={k} label={hint ? `${label} — ${hint}` : label}><input value={form[k] ?? ''} disabled={!admin} inputMode="decimal" onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} /></Field>)}
          <Field label="تذكيرات الحصص (دقائق قبل الموعد، مفصولة بفاصلة)"><input value={reminders} disabled={!admin} onChange={e => setReminders(e.target.value)} /></Field>
        </div>
      </div>
    </Page>
  );
}
