import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, when } from '../api';
import { Page, Badge, Modal, Field, Empty, ar, useToast, errMsg, can, type Me } from '../ui';

const ROLES = ['student', 'parent', 'teacher', 'content_reviewer', 'support', 'finance', 'admin', 'super_admin'];

/** المستخدمون: بحث، إيقاف/تفعيل، أدوار (للمدير العام فقط)، منح محتوى مجاناً */
export default function Users({ me, isSuper }: { me: Me; isSuper: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<any | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const list = useQuery({ queryKey: ['adm-users', q], queryFn: () => api.get<{ data: any[]; meta: any }>('/admin/users', { q: q || undefined, limit: 60 }) });
  const inv = () => qc.invalidateQueries({ queryKey: ['adm-users'] });
  const status = useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => api.post(`/admin/users/${id}/status`, { status, reason: status === 'suspended' ? (prompt('السبب') ?? '') : undefined }), onSuccess: () => { toast('تم'); inv(); }, onError: e => toast(errMsg(e)) });
  const saveRoles = useMutation({ mutationFn: () => api.post(`/admin/users/${sel.id}/roles`, { roles }), onSuccess: () => { toast('حُدّثت الأدوار — يحتاج المستخدم لتسجيل دخول جديد'); setSel(null); inv(); }, onError: e => toast(errMsg(e)) });
  const grant = useMutation({ mutationFn: ({ id, itemType, itemId }: { id: number; itemType: string; itemId: number }) => api.post(`/admin/users/${id}/grant`, { itemType, itemId }), onSuccess: () => toast('مُنح الوصول'), onError: e => toast(errMsg(e)) });
  return (
    <Page title="المستخدمون">
      <div className="toolbar"><input placeholder="الاسم أو الهاتف أو البريد أو الرقم" value={q} onChange={e => setQ(e.target.value)} /><span className="muted small">{list.data?.meta.total ?? 0}</span></div>
      <div className="card tbl">{list.data?.data.length ? (
        <table><thead><tr><th>#</th><th>الاسم</th><th>التواصل</th><th>الأدوار</th><th>الحالة</th><th>آخر دخول</th><th></th></tr></thead>
          <tbody>{list.data.data.map(u => <tr key={u.id}><td className="num">{u.id}</td><td><b>{u.name || '—'}</b></td><td className="num small">{u.phone ?? ''} {u.email ?? ''}</td><td>{u.roles.map((r: string) => <Badge key={r} tone={['admin', 'super_admin'].includes(r) ? 'brand' : r === 'teacher' ? 'gold' : ''}>{ar(r)}</Badge>)}</td><td><Badge tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge></td><td className="num small">{when(u.lastLoginAt)}</td>
            <td className="actions">{isSuper ? <button className="btn secondary sm" onClick={() => { setSel(u); setRoles(u.roles); }}>الأدوار</button> : null} {can(me, 'admin') && u.id !== me.id ? (u.status === 'active' ? <button className="btn danger sm" onClick={() => status.mutate({ id: u.id, status: 'suspended' })}>إيقاف</button> : <button className="btn success sm" onClick={() => status.mutate({ id: u.id, status: 'active' })}>تفعيل</button>) : null} {can(me, 'admin') ? <button className="btn ghost sm" onClick={() => { const t = prompt('النوع: book أو course', 'book'); const id = Number(prompt('رقم العنصر')); if (t && id) grant.mutate({ id: u.id, itemType: t, itemId: id }); }}>منح محتوى</button> : null}</td></tr>)}</tbody></table>
      ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا نتائج'} />}</div>
      {sel ? (
        <Modal title={`أدوار ${sel.name || sel.id}`} onClose={() => setSel(null)} footer={<button className="btn" disabled={saveRoles.isPending || !roles.length} onClick={() => saveRoles.mutate()}>حفظ</button>}>
          <Field label="الأدوار — الصلاحيات تُفرض في الخادم على كل مسار">{ROLES.map(r => <label key={r} className="row" style={{ marginBottom: 4 }}><input type="checkbox" style={{ width: 18, minHeight: 0 }} checked={roles.includes(r)} onChange={e => setRoles(x => e.target.checked ? [...x, r] : x.filter(y => y !== r))} />{ar(r)} <span className="muted small">({r})</span></label>)}</Field>
        </Modal>
      ) : null}
    </Page>
  );
}
