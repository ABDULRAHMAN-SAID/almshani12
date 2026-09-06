import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@manassah/shared';
import { api, when } from '../../api';
import { Badge, PersonLink, ROLES, STAFF, ar, useToast, errMsg, useConfirm, can, isSuper } from '../../ui';
import type { TabProps } from './types';

/** الأدوار: ثمانية صفوف؛ أدوار الطاقم لـ super_admin فقط، ولا يسحب أحد super_admin من نفسه — الدعم/المالية يقرؤون فقط */
export function RolesTab({ me, d, id }: TabProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const change = useMutation({
    mutationFn: ({ op, role, reason }: { op: 'grant' | 'revoke'; role: Role; reason?: string }) => api.post<{ roles: Role[] }>(`/admin/users/${id}/roles/${op}`, { role, reason: reason || undefined }),
    onSuccess: (_r, v) => { toast(STAFF.includes(v.role) ? 'حُدّثت الأدوار — يجب على المستخدم إعادة تسجيل الدخول' : 'حُدّثت الأدوار'); qc.invalidateQueries({ queryKey: ['adm-user', id] }); qc.invalidateQueries({ queryKey: ['adm-users'] }); },
    onError: e => toast(errMsg(e)),
  });
  const admin = can(me, 'admin');
  const toggle = async (role: Role, has: boolean) => {
    const r = await confirm({ title: has ? `سحب دور «${ar(role)}»` : `منح دور «${ar(role)}»`, body: STAFF.includes(role) ? 'تغيير أدوار الطاقم يُنهي جلسات المستخدم الحالية.' : role === 'teacher' && !has ? 'يُنشأ ملفّ معلّم معلّق ينتظر المستندات والقرار.' : undefined, fields: [{ key: 'note', label: 'السبب (اختياري، يُسجَّل)' }], danger: has, confirmLabel: has ? 'سحب' : 'منح' });
    if (r) change.mutate({ op: has ? 'revoke' : 'grant', role, reason: r.note?.trim() });
  };
  return (
    <div className="card tbl">
      <table><thead><tr><th>الدور</th><th>الحالة</th><th>مُنح بواسطة</th><th>منذ</th>{admin ? <th /> : null}</tr></thead>
        <tbody>{(ROLES as Role[]).map(role => {
          const row = d.roles.find(r => r.role === role); const has = !!row;
          const staff = STAFF.includes(role);
          const locked = (staff && !isSuper(me)) || (role === 'super_admin' && id === me.id && has) || d.status === 'deleted';
          const why = staff && !isSuper(me) ? 'أدوار الطاقم يديرها المدير العام فقط' : role === 'super_admin' && id === me.id ? 'لا يمكنك سحب صلاحياتك العليا من نفسك' : d.status === 'deleted' ? 'الحساب محذوف' : undefined;
          return <tr key={role} className={has ? '' : 'dim'}>
            <td><b>{ar(role)}</b> <span className="muted small">({role})</span>{staff ? <Badge tone="info">طاقم</Badge> : null}</td>
            <td>{has ? <Badge tone="success">ممنوح</Badge> : <Badge>—</Badge>}</td>
            <td>{row?.grantedBy ? <PersonLink id={row.grantedBy.id} name={row.grantedBy.name} /> : has ? 'النظام' : '—'}</td>
            <td className="num small">{row ? when(row.createdAt) : '—'}</td>
            {admin ? <td className="actions"><button className={`btn sm ${has ? 'danger' : 'secondary'}`} disabled={locked || change.isPending} title={why} onClick={() => toggle(role, has)}>{has ? 'سحب' : 'منح'}</button></td> : null}
          </tr>;
        })}</tbody></table>
      {!admin ? <p className="muted small" style={{ marginTop: 10 }}>قراءة فقط — تغيير الأدوار للمدير (أدوار الطاقم للمدير العام).</p> : null}
    </div>
  );
}
