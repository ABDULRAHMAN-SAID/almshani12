import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, day } from '../api';
import { Page, Badge, Modal, Field, Empty, useToast, errMsg } from '../ui';

/** الكوبونات: نسبة أو مبلغ ثابت، حدود استخدام، نطاق (عام/معلّم/فئة)، وعرض في الرئيسية */
export default function Coupons() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['adm-coupons'], queryFn: () => api.get<any[]>('/admin/coupons') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', type: 'percentage', value: '10', startsAt: '', endsAt: '', usageLimit: '', userLimit: '1', teacherId: '', category: '', featured: false, title: '' });
  const create = useMutation({
    mutationFn: () => api.post('/admin/coupons', { code: f.code, type: f.type, value: Number(f.value), startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null, usageLimit: f.usageLimit ? Number(f.usageLimit) : null, userLimit: f.userLimit ? Number(f.userLimit) : null, active: true,
      scope: { ...(f.teacherId ? { teacherId: Number(f.teacherId) } : {}), ...(f.category ? { category: f.category } : {}), ...(f.featured ? { featured: true, title: f.title || undefined } : {}) } }),
    onSuccess: () => { toast('أُنشئ الكوبون'); setOpen(false); qc.invalidateQueries({ queryKey: ['adm-coupons'] }); }, onError: e => toast(errMsg(e)),
  });
  const toggle = useMutation({ mutationFn: ({ id, active }: { id: number; active: boolean }) => api.patch(`/admin/coupons/${id}`, { active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['adm-coupons'] }) });
  return (
    <Page title="الكوبونات" actions={<button className="btn" onClick={() => setOpen(true)}>كوبون جديد</button>}>
      <div className="card tbl">{list.data?.length ? (
        <table><thead><tr><th>الرمز</th><th>الخصم</th><th>الصلاحية</th><th>الاستخدام</th><th>النطاق</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{list.data.map(c => <tr key={c.id}><td className="num"><b>{c.code}</b></td><td className="num">{c.type === 'percentage' ? `${c.value}٪` : `${c.value} ر.ع`}</td><td className="num small">{day(c.startsAt)} → {day(c.endsAt)}</td><td className="num">{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}{c.userLimit ? ` · ${c.userLimit} لكل مستخدم` : ''}</td><td className="small">{c.scope.teacherId ? `معلّم #${c.scope.teacherId}` : c.scope.category ? `فئة ${c.scope.category}` : 'عام'}{c.scope.featured ? <Badge tone="gold">يظهر في الرئيسية</Badge> : null}</td><td><Badge tone={c.active ? 'success' : ''}>{c.active ? 'مفعّل' : 'موقوف'}</Badge></td><td className="actions"><button className="btn secondary sm" onClick={() => toggle.mutate({ id: c.id, active: !c.active })}>{c.active ? 'إيقاف' : 'تفعيل'}</button></td></tr>)}</tbody></table>
      ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا كوبونات'} />}</div>
      {open ? (
        <Modal title="كوبون جديد" onClose={() => setOpen(false)} footer={<button className="btn" disabled={create.isPending || f.code.length < 3} onClick={() => create.mutate()}>إنشاء</button>}>
          <div className="grid grid-2">
            <Field label="الرمز"><input value={f.code} onChange={e => setF(s => ({ ...s, code: e.target.value.toUpperCase() }))} /></Field>
            <Field label="النوع"><select value={f.type} onChange={e => setF(s => ({ ...s, type: e.target.value }))}><option value="percentage">نسبة ٪</option><option value="fixed">مبلغ ثابت</option></select></Field>
            <Field label="القيمة"><input value={f.value} inputMode="decimal" onChange={e => setF(s => ({ ...s, value: e.target.value }))} /></Field>
            <Field label="حدّ الاستخدام الكلي (فارغ = بلا حدّ)"><input value={f.usageLimit} inputMode="numeric" onChange={e => setF(s => ({ ...s, usageLimit: e.target.value }))} /></Field>
            <Field label="من"><input type="date" value={f.startsAt} onChange={e => setF(s => ({ ...s, startsAt: e.target.value }))} /></Field>
            <Field label="إلى"><input type="date" value={f.endsAt} onChange={e => setF(s => ({ ...s, endsAt: e.target.value }))} /></Field>
            <Field label="حدّ لكل مستخدم"><input value={f.userLimit} inputMode="numeric" onChange={e => setF(s => ({ ...s, userLimit: e.target.value }))} /></Field>
            <Field label="مقصور على معلّم (رقم المستخدم)"><input value={f.teacherId} inputMode="numeric" onChange={e => setF(s => ({ ...s, teacherId: e.target.value }))} /></Field>
            <Field label="فئة (book / course / lesson / package)"><input value={f.category} onChange={e => setF(s => ({ ...s, category: e.target.value }))} /></Field>
            <Field label="عرض في الرئيسية"><label className="row"><input type="checkbox" style={{ width: 18, minHeight: 0 }} checked={f.featured} onChange={e => setF(s => ({ ...s, featured: e.target.checked }))} />نعم</label></Field>
            {f.featured ? <Field label="عنوان العرض"><input value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} placeholder="خصم ١٠٪ على أول طلب" /></Field> : null}
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}
