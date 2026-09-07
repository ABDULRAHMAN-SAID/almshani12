import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, money, when } from '../api';
import { Page, Badge, Modal, Empty, ErrorState, TeacherLink, STATUS_TONE, ar, useToast, errMsg, useConfirm, can, type Me } from '../ui';

const CHECKS = [['content', 'المحتوى مناسب ومطابق للمنهج'], ['price', 'السعر معقول'], ['file', 'الملف يفتح وصفحاته كاملة'], ['copyright', 'لا انتهاك لحقوق النشر'], ['category', 'التصنيف والصف صحيحان'], ['description', 'الوصف دقيق']] as const;

/** مراجعة الكتب والدورات قبل النشر — بقائمة تحقّق وسبب واضح للمعلّم */
export default function Content({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? 'pending_review');
  const [item, setItem] = useState<any | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const list = useQuery({ queryKey: ['adm-content', status], queryFn: () => api.get<{ data: any[] }>('/admin/content', { status }) });
  const file = useMutation({ mutationFn: (it: any) => api.get<any>(`/admin/content/${it.entityType}/${it.id}/file`) });
  const decide = useMutation({ mutationFn: (b: { decision: string; reason?: string | null }) => api.post(`/admin/content/${item.entityType}/${item.id}/decision`, { ...b, checklist: checks }), onSuccess: () => { toast('تم'); qc.invalidateQueries({ queryKey: ['adm-content'] }); qc.invalidateQueries({ queryKey: ['overview'] }); if (item?.authorId) qc.invalidateQueries({ queryKey: ['adm-teacher', item.authorId] }); setItem(null); }, onError: e => toast(errMsg(e)) });
  const allChecked = CHECKS.every(([k]) => checks[k]);
  // القرار لِما هو «بانتظار المراجعة» فقط — سحب منشور يمرّ بالأرشفة لا بالرفض
  const decidable = item?.status === 'pending_review';
  const teacherCell = (it: any) => can(me, 'support', 'finance') ? <TeacherLink id={it.authorId} name={it.author} /> : <span>{it.author ?? `#${it.authorId}`}</span>;
  const reject = async () => { const r = await confirm({ title: `رفض «${item.title}»`, body: 'يصل السبب للمعلّم ولا يُنشر المحتوى.', reasonRequired: true, reasonLabel: 'سبب الرفض (يصل للمعلّم)', danger: true, confirmLabel: 'رفض' }); if (r) decide.mutate({ decision: 'rejected', reason: r.reason }); };
  return (
    <Page title="مراجعة المحتوى" sub="لا يُنشر شيء دون مراجعة">
      <div className="toolbar">{['pending_review', 'published', 'rejected', 'draft', 'archived', 'all'].map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s === 'all' ? 'الكل' : ar(s)}</button>)}</div>
      <div className="card tbl">
        {list.isError ? <ErrorState error={list.error} /> : list.data?.data.length ? (
          <table><thead><tr><th>النوع</th><th>العنوان</th><th>الحالة</th><th>المعلّم</th><th>المادة / الصف</th><th>السعر</th><th>آخر تحديث</th><th></th></tr></thead>
            <tbody>{list.data.data.map(it => <tr key={`${it.entityType}-${it.id}`}><td><Badge tone={it.entityType === 'book' ? 'info' : 'gold'}>{ar(it.entityType)}</Badge></td><td><b>{it.title}</b>{it.type ? <div className="muted small">{it.type}</div> : null}</td><td><Badge tone={STATUS_TONE[it.status]}>{ar(it.status)}</Badge></td><td>{teacherCell(it)}</td><td>{it.subject} · {it.grade}</td><td className="num">{money(it.price)}</td><td className="num small">{when(it.updated_at)}</td><td className="actions"><button className="btn secondary sm" onClick={() => { setItem(it); setChecks({}); }}>مراجعة</button></td></tr>)}</tbody></table>
        ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا محتوى في هذه الحالة'} />}
      </div>
      {item ? (
        <Modal title={item.title} onClose={() => setItem(null)} footer={decidable ? <><button className="btn danger" disabled={decide.isPending} onClick={reject}>رفض (بسبب)</button><button className="btn success" disabled={decide.isPending || !allChecked} onClick={() => decide.mutate({ decision: 'approved', reason: null })}>اعتماد ونشر</button></> : <span className="muted small">القرار متاح لما هو «بانتظار المراجعة» فقط.</span>}>
          <div className="row" style={{ marginBottom: 12 }}><Badge tone={STATUS_TONE[item.status]}>{ar(item.status)}</Badge><span className="muted small">{item.author} · {item.subject} · {item.grade} · {money(item.price)}</span>
            <button className="btn secondary sm" onClick={() => file.mutate(item, { onSuccess: r => { const url = Array.isArray(r) ? r.find((x: any) => x.url)?.url : r.url; url ? window.open(url, '_blank') : toast('لا ملف مرفوع'); } })}>{file.isPending ? '…' : 'فتح الملف (رابط ١٥ دقيقة)'}</button></div>
          <h3>قائمة التحقّق</h3>
          {CHECKS.map(([k, label]) => <label key={k} className="row" style={{ marginBottom: 6, cursor: 'pointer' }}><input type="checkbox" style={{ width: 18, minHeight: 0 }} checked={!!checks[k]} onChange={e => setChecks(c => ({ ...c, [k]: e.target.checked }))} />{label}</label>)}
        </Modal>
      ) : null}
    </Page>
  );
}
