import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PageMeta } from '@manassah/shared';
import { api, money, when } from '../api';
import { Page, Badge, Modal, DataTable, TeacherLink, STATUS_TONE, ar, useToast, errMsg, useConfirm, can, type Me, type Column } from '../ui';

const CHECKS = [['content', 'المحتوى مناسب ومطابق للمنهج'], ['price', 'السعر معقول'], ['file', 'الملف يفتح وصفحاته كاملة'], ['copyright', 'لا انتهاك لحقوق النشر'], ['category', 'التصنيف والصف صحيحان'], ['description', 'الوصف دقيق']] as const;

type ContentItem = { id: number; title: string; type: string | null; price: number; status: string; updated_at: string; authorId: number; author: string | null; subject: string; grade: string; entityType: 'book' | 'course' };

/** مراجعة الكتب والدورات قبل النشر — بقائمة تحقّق وسبب واضح للمعلّم */
export default function Content({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? 'pending_review');
  const [page, setPage] = useState(1);
  const [item, setItem] = useState<ContentItem | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const list = useQuery({ queryKey: ['adm-content', status, page], queryFn: () => api.get<{ data: ContentItem[]; meta: PageMeta }>('/admin/content', { status, page, limit: 30 }) });
  const file = useMutation({ mutationFn: (it: ContentItem) => api.get<any>(`/admin/content/${it.entityType}/${it.id}/file`) });
  const decide = useMutation({ mutationFn: (b: { decision: string; reason?: string | null }) => api.post(`/admin/content/${item!.entityType}/${item!.id}/decision`, { ...b, checklist: checks }), onSuccess: () => { toast('تم'); qc.invalidateQueries({ queryKey: ['adm-content'] }); qc.invalidateQueries({ queryKey: ['overview'] }); if (item?.authorId) qc.invalidateQueries({ queryKey: ['adm-teacher', item.authorId] }); setItem(null); }, onError: e => toast(errMsg(e)) });
  const allChecked = CHECKS.every(([k]) => checks[k]);
  // القرار لِما هو «بانتظار المراجعة» فقط — سحب منشور يمرّ بالأرشفة لا بالرفض
  const decidable = item?.status === 'pending_review';
  const teacherCell = (it: ContentItem) => can(me, 'support', 'finance') ? <TeacherLink id={it.authorId} name={it.author} /> : <span>{it.author ?? `#${it.authorId}`}</span>;
  const reject = async () => { const r = await confirm({ title: `رفض «${item!.title}»`, body: 'يصل السبب للمعلّم ولا يُنشر المحتوى.', reasonRequired: true, reasonLabel: 'سبب الرفض (يصل للمعلّم)', danger: true, confirmLabel: 'رفض' }); if (r) decide.mutate({ decision: 'rejected', reason: r.reason }); };
  const cols: Column<ContentItem>[] = [
    { key: 'entityType', label: 'النوع', render: it => <Badge tone={it.entityType === 'book' ? 'info' : 'gold'}>{ar(it.entityType)}</Badge> },
    { key: 'title', label: 'العنوان', render: it => <>{<b>{it.title}</b>}{it.type ? <div className="muted small">{it.type}</div> : null}</> },
    { key: 'status', label: 'الحالة', render: it => <Badge tone={STATUS_TONE[it.status]}>{ar(it.status)}</Badge> },
    { key: 'author', label: 'المعلّم', render: teacherCell },
    { key: 'subjectGrade', label: 'المادة / الصف', render: it => <>{it.subject} · {it.grade}</> },
    { key: 'price', label: 'السعر', className: 'num', render: it => money(it.price) },
    { key: 'updated_at', label: 'آخر تحديث', className: 'num small', render: it => when(it.updated_at) },
    { key: 'actions', label: '', className: 'actions', render: it => <button className="btn secondary sm" onClick={() => { setItem(it); setChecks({}); }}>مراجعة</button> },
  ];
  return (
    <Page title="مراجعة المحتوى" sub="لا يُنشر شيء دون مراجعة">
      <div className="toolbar">{['pending_review', 'published', 'rejected', 'draft', 'archived', 'all'].map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => { setStatus(s); setPage(1); }}>{s === 'all' ? 'الكل' : ar(s)}</button>)}</div>
      <div className="card"><DataTable columns={cols} rows={list.data?.data} meta={list.data?.meta} onPage={setPage} rowKey={it => `${it.entityType}-${it.id}`} loading={list.isLoading} error={list.error} empty="لا محتوى في هذه الحالة" /></div>
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
