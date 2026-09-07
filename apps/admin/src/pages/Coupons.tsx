import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, day } from '../api';
import { Page, Badge, Modal, Field, Empty, ErrorState, useToast, errMsg } from '../ui';

type Scope = { teacherId?: number; category?: string; featured?: boolean; title?: string; products?: unknown[] };
type Coupon = { id: number; code: string; type: string; value: number; startsAt: string | null; endsAt: string | null; usageLimit: number | null; userLimit: number | null; usedCount: number; scope: Scope; active: boolean };
type Form = { code: string; type: string; value: string; startsAt: string; endsAt: string; usageLimit: string; userLimit: string; teacherId: string; category: string; featured: boolean; title: string };

const EMPTY: Form = { code: '', type: 'percentage', value: '10', startsAt: '', endsAt: '', usageLimit: '', userLimit: '1', teacherId: '', category: '', featured: false, title: '' };
const CATEGORIES = ['', 'book', 'course', 'lesson', 'package', 'subscription'];
const CAT_AR: Record<string, string> = { '': 'كل الفئات', book: 'كتاب', course: 'دورة', lesson: 'حصة', package: 'باقة', subscription: 'اشتراك' };
/** ISO → قيمة حقل التاريخ */
const dateOf = (iso: string | null) => iso ? iso.slice(0, 10) : '';
const formOf = (c: Coupon): Form => ({
  code: c.code, type: c.type, value: String(c.value), startsAt: dateOf(c.startsAt), endsAt: dateOf(c.endsAt),
  usageLimit: c.usageLimit == null ? '' : String(c.usageLimit), userLimit: c.userLimit == null ? '' : String(c.userLimit),
  teacherId: c.scope?.teacherId ? String(c.scope.teacherId) : '', category: c.scope?.category ?? '', featured: !!c.scope?.featured, title: c.scope?.title ?? '',
});
/** رقم صالح أو null — الفراغ لا يصير صفراً */
const num = (v: string) => { const t = v.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
/** جسم كامل يصلح للإنشاء وللتعديل — النطاق يحتفظ بالمفاتيح غير المحرَّرة هنا (products) */
const bodyOf = (f: Form, base?: Coupon | null) => ({
  code: f.code.trim().toUpperCase(), type: f.type, value: num(f.value),
  startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
  usageLimit: num(f.usageLimit), userLimit: num(f.userLimit), active: base ? base.active : true,
  scope: {
    ...(base?.scope ?? {}), teacherId: undefined, category: undefined, featured: undefined, title: undefined,
    ...(f.teacherId ? { teacherId: num(f.teacherId) ?? undefined } : {}), ...(f.category ? { category: f.category } : {}),
    ...(f.featured ? { featured: true, ...(f.title.trim() ? { title: f.title.trim() } : {}) } : {}),
  },
});
/** خطأ مقروء قبل الإرسال — نفس قيود CouponUpsert */
function formError(f: Form): string | null {
  if (f.code.trim().length < 3) return 'الرمز ٣ أحرف على الأقل';
  const v = num(f.value);
  if (v === null || v <= 0) return 'قيمة الخصم يجب أن تكون رقماً أكبر من صفر';
  if (f.type === 'percentage' && (v < 1 || v > 90)) return 'نسبة الخصم بين ١٪ و٩٠٪';
  for (const [k, label] of [['usageLimit', 'سقف الاستخدام'], ['userLimit', 'سقف المستخدم'], ['teacherId', 'رقم المعلّم']] as const) {
    const raw = f[k].trim(); if (raw && (num(raw) === null || num(raw)! < 1)) return `${label}: رقم غير صالح`;
  }
  if (f.startsAt && f.endsAt && f.endsAt < f.startsAt) return 'تاريخ الانتهاء قبل تاريخ البداية';
  return null;
}

/** الكوبونات: نسبة أو مبلغ ثابت، حدود استخدام، نطاق (عام/معلّم/فئة)، وعرض في الرئيسية — كلّها قابلة للتعديل بعد الإنشاء */
export default function Coupons() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['adm-coupons'], queryFn: () => api.get<Coupon[]>('/admin/coupons') });
  const [edit, setEdit] = useState<{ base: Coupon | null; f: Form } | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['adm-coupons'] });
  const save = useMutation({
    mutationFn: ({ base, f }: { base: Coupon | null; f: Form }) => base
      ? api.patch(`/admin/coupons/${base.id}`, bodyOf(f, base))
      : api.post('/admin/coupons', bodyOf(f)),
    onSuccess: (_r, v) => { toast(v.base ? 'حُفظ الكوبون' : 'أُنشئ الكوبون'); setEdit(null); inv(); }, onError: e => toast(errMsg(e)),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.patch(`/admin/coupons/${id}`, { active }),
    onSuccess: (_r, v) => { toast(v.active ? 'فُعّل الكوبون' : 'أُوقف الكوبون'); inv(); }, onError: e => toast(errMsg(e)),
  });
  const set = (p: Partial<Form>) => setEdit(s => s ? { ...s, f: { ...s.f, ...p } } : s);
  const err = edit ? formError(edit.f) : null;
  return (
    <Page title="الكوبونات" actions={<button className="btn" onClick={() => setEdit({ base: null, f: EMPTY })}>كوبون جديد</button>}>
      <div className="card tbl">{list.isError ? <ErrorState error={list.error} /> : list.data?.length ? (
        <table><thead><tr><th>الرمز</th><th>الخصم</th><th>الصلاحية</th><th>الاستخدام</th><th>النطاق</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{list.data.map(c => <tr key={c.id}>
            <td className="num"><b>{c.code}</b></td>
            <td className="num">{c.type === 'percentage' ? `${c.value}٪` : `${c.value} ر.ع`}</td>
            <td className="num small">{day(c.startsAt)} → {day(c.endsAt)}</td>
            <td className="num">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}{c.userLimit ? ` · ${c.userLimit} لكل مستخدم` : ''}</td>
            <td className="small">{c.scope?.teacherId ? `معلّم #${c.scope.teacherId}` : c.scope?.category ? `فئة ${CAT_AR[c.scope.category] ?? c.scope.category}` : 'عام'}{c.scope?.featured ? <Badge tone="gold">يظهر في الرئيسية</Badge> : null}</td>
            <td><Badge tone={c.active ? 'success' : ''}>{c.active ? 'مفعّل' : 'موقوف'}</Badge></td>
            <td className="actions">
              <button className="btn secondary sm" onClick={() => setEdit({ base: c, f: formOf(c) })}>تعديل</button>{' '}
              <button className="btn ghost sm" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: c.id, active: !c.active })}>{c.active ? 'إيقاف' : 'تفعيل'}</button>
            </td>
          </tr>)}</tbody></table>
      ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا كوبونات'} />}</div>
      {edit ? (
        <Modal
          title={edit.base ? `تعديل الكوبون ${edit.base.code}` : 'كوبون جديد'}
          onClose={() => setEdit(null)}
          footer={<><span className="error" style={{ marginInlineEnd: 'auto' }}>{err ?? ''}</span><button className="btn secondary" onClick={() => setEdit(null)}>إلغاء</button><button className="btn" disabled={save.isPending || !!err} onClick={() => save.mutate(edit)}>{edit.base ? 'حفظ' : 'إنشاء'}</button></>}
        >
          {edit.base ? <p className="muted small" style={{ marginTop: 0 }}>استُخدم {edit.base.usedCount} مرة — التعديل لا يمسّ الطلبات السابقة.</p> : null}
          <div className="grid grid-2">
            <Field label="الرمز"><input value={edit.f.code} onChange={e => set({ code: e.target.value.toUpperCase() })} /></Field>
            <Field label="النوع"><select value={edit.f.type} onChange={e => set({ type: e.target.value })}><option value="percentage">نسبة ٪</option><option value="fixed">مبلغ ثابت</option></select></Field>
            <Field label="القيمة"><input value={edit.f.value} inputMode="decimal" onChange={e => set({ value: e.target.value })} /></Field>
            <Field label="حدّ الاستخدام الكلي (فارغ = بلا حدّ)"><input value={edit.f.usageLimit} inputMode="numeric" onChange={e => set({ usageLimit: e.target.value })} /></Field>
            <Field label="من"><input type="date" value={edit.f.startsAt} onChange={e => set({ startsAt: e.target.value })} /></Field>
            <Field label="إلى"><input type="date" value={edit.f.endsAt} onChange={e => set({ endsAt: e.target.value })} /></Field>
            <Field label="حدّ لكل مستخدم (فارغ = بلا حدّ)"><input value={edit.f.userLimit} inputMode="numeric" onChange={e => set({ userLimit: e.target.value })} /></Field>
            <Field label="مقصور على معلّم (رقم المستخدم، فارغ = الكل)"><input value={edit.f.teacherId} inputMode="numeric" onChange={e => set({ teacherId: e.target.value })} /></Field>
            <Field label="الفئة"><select value={edit.f.category} onChange={e => set({ category: e.target.value })}>{CATEGORIES.map(c => <option key={c} value={c}>{CAT_AR[c]}</option>)}</select></Field>
            <Field label="عرض في الرئيسية"><label className="row"><input type="checkbox" style={{ width: 18, minHeight: 0 }} checked={edit.f.featured} onChange={e => set({ featured: e.target.checked })} />نعم</label></Field>
            {edit.f.featured ? <Field label="عنوان العرض"><input value={edit.f.title} onChange={e => set({ title: e.target.value })} placeholder="خصم ١٠٪ على أول طلب" /></Field> : null}
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
