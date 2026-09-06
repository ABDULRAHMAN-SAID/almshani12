import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PersonEntitlements } from '@manassah/shared';
import { api, day } from '../../api';
import { Badge, Drawer, Field, Empty, LearnerChip, TeacherLink, STATUS_TONE, ar, useToast, errMsg, useConfirm, useDebounced, can } from '../../ui';
import type { TabProps } from './types';

type ContentHit = { id: number; title: string; entityType: 'book' | 'course'; author: string; subject: string; grade: string; status: string };

/** منح كتاب/دورة (للمدير): بحث في المحتوى المنشور، انتهاء اختياري، وملاحظة تُسجَّل */
function GrantDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<'book' | 'course'>('book');
  const [q, setQ] = useState('');
  const [item, setItem] = useState<ContentHit | null>(null);
  const [expires, setExpires] = useState('');
  const [note, setNote] = useState('');
  const dq = useDebounced(q);
  const hits = useQuery({ queryKey: ['adm-content', 'published', dq], queryFn: () => api.get<{ data: ContentHit[] }>('/admin/content', { status: 'published', q: dq || undefined }) });
  const grant = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/grant`, { itemType: type, itemId: item!.id, expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null, note: note.trim() || undefined }),
    onSuccess: () => { toast('مُنح الوصول'); qc.invalidateQueries({ queryKey: ['adm-entitlements', id] }); qc.invalidateQueries({ queryKey: ['adm-user', id] }); onClose(); }, onError: e => toast(errMsg(e)),
  });
  const list = (hits.data?.data ?? []).filter(h => h.entityType === type);
  return (
    <Drawer title="منح محتوى" onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>إلغاء</button><button className="btn" disabled={!item || grant.isPending} onClick={() => grant.mutate()}>منح</button></>}>
      <Field label="النوع"><select value={type} onChange={e => { setType(e.target.value as 'book' | 'course'); setItem(null); }}><option value="book">كتاب</option><option value="course">دورة</option></select></Field>
      <Field label="بحث في المحتوى المنشور"><input value={q} onChange={e => setQ(e.target.value)} placeholder="العنوان" autoFocus /></Field>
      <div className="card" style={{ padding: 8, maxHeight: 260, overflow: 'auto', marginBottom: 12 }}>
        {list.length ? list.slice(0, 30).map(h => <button key={h.id} type="button" className={`btn ${item?.id === h.id ? '' : 'ghost'} sm`} style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginBottom: 4 }} onClick={() => setItem(h)}><span>{h.title}</span><span className="small" style={{ opacity: .8 }}>{h.author} · {h.subject} · {h.grade}</span></button>) : <Empty text={hits.isLoading ? 'جارٍ البحث…' : 'لا نتائج'} />}
      </div>
      <Field label="ينتهي في (اختياري)"><input type="date" value={expires} onChange={e => setExpires(e.target.value)} /></Field>
      <Field label="ملاحظة (تُسجَّل)"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
    </Drawer>
  );
}

/** الامتلاك على مستوى الحساب: الاستحقاقات، التسجيل في الدورات، الباقات، الاشتراكات — الإلغاء والمنح للمدير */
export function EntitlementsTab({ me, id }: TabProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [grantOpen, setGrantOpen] = useState(false);
  const e = useQuery({ queryKey: ['adm-entitlements', id], queryFn: () => api.get<PersonEntitlements>(`/admin/users/${id}/entitlements`) });
  const revoke = useMutation({ mutationFn: ({ entId, reason }: { entId: number; reason: string }) => api.delete(`/admin/users/${id}/entitlements/${entId}`, { reason }), onSuccess: () => { toast('أُلغي الاستحقاق'); qc.invalidateQueries({ queryKey: ['adm-entitlements', id] }); qc.invalidateQueries({ queryKey: ['adm-user', id] }); }, onError: err => toast(errMsg(err)) });
  const askRevoke = async (title: string, entId: number) => { const r = await confirm({ title: `إلغاء الوصول إلى «${title}»`, body: 'يفقد الحساب الوصول فوراً. لا يُسترجع المال من هنا — استخدم الاسترجاع من الطلب.', reasonRequired: true, danger: true, confirmLabel: 'إلغاء الوصول' }); if (r) revoke.mutate({ entId, reason: r.reason }); };
  const admin = can(me, 'admin');
  const d = e.data;
  if (!d) return <Empty text={e.isLoading ? 'جارٍ التحميل…' : errMsg(e.error)} />;
  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}><p className="muted small" style={{ margin: 0 }}>المشتريات متاحة لكل متعلّمي الحساب (على مستوى الحساب).</p>{admin ? <button className="btn" onClick={() => setGrantOpen(true)}>منح محتوى</button> : null}</div>
      <div className="card"><h2>الاستحقاقات ({d.entitlements.length})</h2>
        {d.entitlements.length ? <div className="cards">{d.entitlements.map(x => <div className="mini" key={x.id}><div className="row between"><b>{x.title || `${ar(x.itemType)} #${x.itemId}`}</b><Badge tone={x.itemType === 'book' ? 'info' : x.itemType === 'course' ? 'gold' : ''}>{ar(x.itemType)}</Badge></div>
          <div className="small muted" style={{ marginTop: 4 }}><Badge tone={x.source === 'admin' ? 'warning' : x.source === 'purchase' ? 'success' : ''}>{ar(x.source)}</Badge> {x.orderNumber ? <Link to={`/orders?q=${x.orderNumber}`} className="num">{x.orderNumber}</Link> : null} · منذ <span className="num">{day(x.createdAt)}</span>{x.expiresAt ? <> · ينتهي <span className="num">{day(x.expiresAt)}</span></> : null}</div>
          {admin ? <div className="row end" style={{ marginTop: 6 }}><button className="btn ghost sm" onClick={() => askRevoke(x.title || `#${x.itemId}`, x.id)}>إلغاء</button></div> : null}</div>)}</div> : <Empty text="لا استحقاقات" />}
      </div>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card"><h2>الدورات ({d.enrollments.length})</h2>
          {d.enrollments.length ? d.enrollments.map(x => <div key={x.courseId} style={{ marginBottom: 10 }}><div className="row between"><b>{x.title}</b><span className="num small">{Math.round(x.progressPercent)}٪{x.completedAt ? ' · مكتملة' : ''}</span></div><div className="progress"><i style={{ width: `${Math.min(100, x.progressPercent)}%` }} /></div><div className="small muted">المتعلّم: <LearnerChip learner={x.learner} /></div></div>) : <Empty text="لا تسجيل في دورات" />}
        </div>
        <div className="card"><h2>باقات الحصص ({d.packages.length})</h2>
          {d.packages.length ? <table><thead><tr><th>المعلّم</th><th>المتبقّي</th><th>المتعلّم</th><th>ينتهي</th></tr></thead><tbody>{d.packages.map(p => <tr key={p.id}><td><TeacherLink id={p.teacher.id} name={p.teacher.name} /></td><td className="num">{p.remaining} / {p.total}</td><td>{p.learner ? <LearnerChip learner={p.learner} /> : <span className="muted small">أي متعلّم</span>}</td><td className="num small">{day(p.expiresAt)}</td></tr>)}</tbody></table> : <Empty text="لا باقات" />}
          <h2 style={{ marginTop: 14 }}>الاشتراكات ({d.subscriptions.length})</h2>
          {d.subscriptions.length ? d.subscriptions.map(s => <div key={s.id} className="row between"><span>{s.planName}</span><span><Badge tone={STATUS_TONE[s.status]}>{ar(s.status)}</Badge> <span className="num small">{day(s.expiresAt)}</span></span></div>) : <Empty text="لا اشتراكات" />}
        </div>
      </div>
      {grantOpen ? <GrantDrawer id={id} onClose={() => setGrantOpen(false)} /> : null}
    </>
  );
}
