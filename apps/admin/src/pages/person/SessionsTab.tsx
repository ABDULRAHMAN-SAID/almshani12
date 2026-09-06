import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PersonSessions, SessionRow, DeviceRow } from '@manassah/shared';
import { api, when } from '../../api';
import { Badge, DataTable, useToast, errMsg, useConfirm, type Column } from '../../ui';
import type { TabProps } from './types';

/** الجلسات والأجهزة: إنهاء جلسة واحدة أو الكل (مع حذف رموز الإشعارات اختياريّاً) — يُبلَّغ الجهاز فوراً */
export function SessionsTab({ id }: TabProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const s = useQuery({ queryKey: ['adm-sessions', id], queryFn: () => api.get<PersonSessions>(`/admin/users/${id}/sessions`) });
  const revoke = useMutation({ mutationFn: (b: { sessionId?: number; deviceTokens: boolean }) => api.post(`/admin/users/${id}/sessions/revoke`, b), onSuccess: () => { toast('تم الإنهاء'); qc.invalidateQueries({ queryKey: ['adm-sessions', id] }); qc.invalidateQueries({ queryKey: ['adm-user', id] }); }, onError: e => toast(errMsg(e)) });
  const one = async (row: SessionRow) => { const r = await confirm({ title: `إنهاء الجلسة #${row.id}`, body: `${row.device ?? 'جهاز غير معروف'} · ${row.ip ?? ''} — تسقط عند تجديدها التالي.`, danger: true, confirmLabel: 'إنهاء' }); if (r) revoke.mutate({ sessionId: row.id, deviceTokens: false }); };
  const all = async () => { const r = await confirm({ title: 'إنهاء كل الجلسات', body: 'يخرج المستخدم من كل أجهزته فوراً.', fields: [{ key: 'dt', label: 'رموز الإشعارات', type: 'checkbox', initial: 'true', placeholder: 'حذف رموز الإشعارات أيضاً' }], danger: true, confirmLabel: 'إنهاء الكل' }); if (r) revoke.mutate({ deviceTokens: r.dt === 'true' }); };
  const cols: Column<SessionRow>[] = [
    { key: 'id', label: '#', className: 'num', render: r => r.id },
    { key: 'device', label: 'الجهاز', render: r => r.device ?? <span className="muted">—</span> },
    { key: 'ip', label: 'IP', className: 'num small', render: r => r.ip ?? '—' },
    { key: 'created', label: 'بدأت', className: 'num small', render: r => when(r.createdAt) },
    { key: 'exp', label: 'تنتهي', className: 'num small', render: r => when(r.expiresAt) },
    { key: 'st', label: 'الحالة', render: r => r.revoked ? <Badge tone="danger">مُنهاة</Badge> : new Date(r.expiresAt).getTime() < Date.now() ? <Badge>منتهية</Badge> : <Badge tone="success">نشطة</Badge> },
    { key: 'act', label: '', className: 'actions', render: r => !r.revoked && new Date(r.expiresAt).getTime() >= Date.now() ? <button className="btn danger sm" disabled={revoke.isPending} onClick={() => one(r)}>إنهاء</button> : null },
  ];
  const dcols: Column<DeviceRow>[] = [
    { key: 'platform', label: 'المنصّة', render: d => d.platform },
    { key: 'token', label: 'الرمز (آخر ٦)', className: 'mono', render: d => `…${d.tokenSuffix}` },
    { key: 'at', label: 'سُجّل', className: 'num small', render: d => when(d.createdAt) },
  ];
  return (
    <>
      <div className="card"><div className="row between" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>الجلسات (آخر ٥٠)</h2><button className="btn danger sm" disabled={revoke.isPending} onClick={all}>إنهاء الكل</button></div><DataTable columns={cols} rows={s.data?.sessions} loading={s.isLoading} rowClass={r => r.revoked ? 'dim' : ''} empty="لا جلسات" /></div>
      <div className="card"><h2>الأجهزة (رموز الإشعارات)</h2><DataTable columns={dcols} rows={s.data?.devices} loading={s.isLoading} empty="لا أجهزة مسجّلة" /></div>
    </>
  );
}
