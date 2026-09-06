import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TeacherAdminDetail } from '@manassah/shared';
import { api, when } from '../../api';
import { Badge, Empty, PersonLink, STATUS_TONE, ar, useToast, errMsg, useConfirm, can, type Me } from '../../ui';

type Doc = TeacherAdminDetail['documents'][number];

/** المستندات: بطاقة لكل مستند بمعاينة مضمّنة (صورة/PDF بروابط ١٠ دقائق) وقبول/رفض بملاحظة للمدير */
export function DocumentsTab({ me, d }: { me: Me; d: TeacherAdminDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const decide = useMutation({ mutationFn: ({ docId, decision, note }: { docId: number; decision: 'accepted' | 'rejected'; note?: string }) => api.post(`/admin/teachers/${d.id}/documents/${docId}/decision`, { decision, note }), onSuccess: () => { toast('سُجّل القرار'); qc.invalidateQueries({ queryKey: ['adm-teacher', d.id] }); qc.invalidateQueries({ queryKey: ['overview'] }); }, onError: e => toast(errMsg(e)) });
  const accept = async (x: Doc) => { const r = await confirm({ title: `قبول ${ar(x.type)}`, body: x.name ?? undefined, fields: [{ key: 'note', label: 'ملاحظة (اختياري)' }], confirmLabel: 'قبول' }); if (r) decide.mutate({ docId: x.id, decision: 'accepted', note: r.note?.trim() || undefined }); };
  const reject = async (x: Doc) => { const r = await confirm({ title: `رفض ${ar(x.type)}`, body: 'تصل الملاحظة للمعلّم مع طلب إعادة الرفع.', reasonRequired: true, reasonLabel: 'الملاحظة (تصل للمعلّم)', danger: true, confirmLabel: 'رفض' }); if (r) decide.mutate({ docId: x.id, decision: 'rejected', note: r.reason }); };
  const admin = can(me, 'admin');
  if (!d.documents.length) return <div className="card"><Empty text="لم يرفع المعلّم مستندات بعد" /></div>;
  return (
    <>
      <p className="muted small">روابط الملفات موقّعة وصالحة ١٠ دقائق من فتح الصفحة — أعد التحميل إن انتهت.</p>
      {d.documents.map(x => (
        <div className="card" key={x.id}>
          <div className="doc">
            <div>
              <div className="row" style={{ marginBottom: 8 }}><h3 style={{ margin: 0 }}>{ar(x.type)}</h3><Badge tone={STATUS_TONE[x.status]}>{ar(x.status)}</Badge></div>
              <dl className="kv small">
                <dt>الملف</dt><dd><a href={x.url} target="_blank" rel="noreferrer" className="mono">{x.name ?? `#${x.id}`}</a> <span className="muted">({x.mime})</span></dd>
                <dt>رُفع</dt><dd className="num">{when(x.createdAt)}</dd>
                <dt>الملاحظة</dt><dd>{x.note ?? '—'}</dd>
                <dt>راجعه</dt><dd>{x.reviewedBy ? <><PersonLink id={x.reviewedBy.id} name={x.reviewedBy.name} /> · <span className="num">{when(x.reviewedAt)}</span></> : '—'}</dd>
              </dl>
              {admin ? <div className="row" style={{ marginTop: 10 }}><button className="btn success sm" disabled={decide.isPending || x.status === 'accepted'} onClick={() => accept(x)}>قبول</button><button className="btn danger sm" disabled={decide.isPending || x.status === 'rejected'} onClick={() => reject(x)}>رفض مع ملاحظة</button></div> : null}
            </div>
            <div className="preview">{x.mime.startsWith('image/') ? <img src={x.url} alt={x.name ?? ''} /> : x.mime === 'application/pdf' ? <iframe src={x.url} title={x.name ?? 'pdf'} /> : <a className="btn secondary sm" href={x.url} target="_blank" rel="noreferrer">فتح الملف</a>}</div>
          </div>
        </div>
      ))}
    </>
  );
}
