import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, money, when } from '../api';
import { Page, Badge, Modal, Field, Empty, STATUS_TONE, ar, useToast, errMsg, can, type Me } from '../ui';

/** تحقّق المعلّمين: قائمة بالحالة، تفاصيل + مستندات بروابط موقّعة قصيرة، قرار مسجَّل */
export default function Teachers({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [rate, setRate] = useState('');
  const list = useQuery({ queryKey: ['adm-teachers', status, q], queryFn: () => api.get<{ data: any[]; meta: any }>('/admin/teachers', { status: status || undefined, q: q || undefined, limit: 50 }) });
  const detail = useQuery({ queryKey: ['adm-teacher', open], queryFn: () => api.get<any>(`/admin/teachers/${open}`), enabled: !!open });
  const decide = useMutation({ mutationFn: (b: { decision: string; reason?: string | null; commissionRate?: number }) => api.post(`/admin/teachers/${open}/decision`, b), onSuccess: () => { toast('تم تسجيل القرار'); qc.invalidateQueries({ queryKey: ['adm-teachers'] }); qc.invalidateQueries({ queryKey: ['adm-teacher', open] }); qc.invalidateQueries({ queryKey: ['overview'] }); }, onError: e => toast(errMsg(e)) });
  const d = detail.data;
  return (
    <Page title="المعلّمون" sub="كل قرار يُسجَّل باسم من اتّخذه">
      <div className="toolbar">
        {['pending', 'under_review', 'verified', 'rejected', 'suspended', ''].map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s ? ar(s) : 'الكل'}</button>)}
        <input placeholder="بحث بالاسم أو الهاتف" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="card tbl">
        {list.data?.data.length ? (
          <table><thead><tr><th>المعلّم</th><th>التخصّص</th><th>الخبرة</th><th>الحالة</th><th>قدّم في</th><th>الحصص</th><th></th></tr></thead>
            <tbody>{list.data.data.map(t => <tr key={t.id}><td><b>{t.name}</b><div className="muted small num">{t.phone ?? t.email}</div></td><td>{t.specialty ?? t.headline ?? '—'}</td><td className="num">{t.yearsExp} سنة</td><td><Badge tone={STATUS_TONE[t.status]}>{ar(t.status)}</Badge></td><td className="num small">{when(t.appliedAt)}</td><td className="num">{t.lessonsCount}</td><td className="actions"><button className="btn secondary sm" onClick={() => { setOpen(t.id); setReason(''); setRate(''); }}>مراجعة</button></td></tr>)}</tbody></table>
        ) : <Empty text={list.isLoading ? 'جارٍ التحميل…' : 'لا طلبات في هذه الحالة'} />}
      </div>
      {open ? (
        <Modal title={d?.name ?? '…'} onClose={() => setOpen(null)}>
          {d ? (<>
            <div className="row" style={{ marginBottom: 12 }}><Badge tone={STATUS_TONE[d.status]}>{ar(d.status)}</Badge><span className="muted small">عمولة {Math.round(d.commissionRate * 100)}٪ · {d.stats.bookings} حجز · أرباح {money(d.stats.earnings)}</span></div>
            <dl className="kv">
              <dt>الهاتف / البريد</dt><dd className="num">{d.phone ?? '—'} · {d.email ?? '—'}</dd>
              <dt>العنوان المهني</dt><dd>{d.headline}</dd><dt>المؤهّل</dt><dd>{d.qualification} — {d.specialty}</dd>
              <dt>الخبرة</dt><dd>{d.yearsExp} سنة · {(d.languages as string[]).join('، ')} · {d.gender === 'female' ? 'معلّمة' : d.gender === 'male' ? 'معلّم' : '—'}</dd>
              <dt>النبذة</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{d.bio}</dd>
              <dt>المواد والصفوف</dt><dd>{d.subjects.map((s: any) => `${s.subject} (${s.grade})`).join('، ') || '—'}</dd>
              <dt>الأسعار</dt><dd>{d.prices.map((p: any) => `${p.durationMinutes} د ${p.mode === 'group' ? 'جماعي' : 'فردي'}: ${money(p.price)}`).join(' · ') || '—'}</dd>
              <dt>المستندات</dt><dd>{d.documents.length ? d.documents.map((x: any) => <div key={x.id}><a href={x.url} target="_blank" rel="noreferrer">{ar(x.type) === x.type ? x.type : ar(x.type)} — {x.name}</a> <span className="muted small">({x.status})</span></div>) : '—'}<div className="muted small">الروابط صالحة ١٠ دقائق</div></dd>
              <dt>السجلّ</dt><dd>{d.history.length ? d.history.map((h: any, i: number) => <div key={i} className="small">{ar(h.decision)} — {h.reviewer ?? 'النظام'} — {when(h.decided_at)}{h.reason ? ` — ${h.reason}` : ''}</div>) : '—'}</dd>
            </dl>
            {can(me, 'admin') ? (
              <div className="card" style={{ marginTop: 16, background: 'var(--bg-2)' }}>
                <h3>القرار</h3>
                <div className="grid grid-2"><Field label="السبب (يصل للمعلّم عند الرفض/الإيقاف)"><input value={reason} onChange={e => setReason(e.target.value)} /></Field><Field label="نسبة العمولة (اختياري، مثال 0.15)"><input value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" /></Field></div>
                <div className="row end">
                  <button className="btn secondary" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'under_review', reason })}>قيد المراجعة</button>
                  <button className="btn danger" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'rejected', reason })}>رفض</button>
                  {d.status === 'verified' ? <button className="btn danger" disabled={decide.isPending} onClick={() => confirm('إيقاف المعلّم يلغي حصصه القادمة ويعيد المبالغ للطلاب. متابعة؟') && decide.mutate({ decision: 'suspended', reason })}>إيقاف</button> : null}
                  <button className="btn success" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'verified', reason, commissionRate: rate ? Number(rate) : undefined })}>اعتماد</button>
                </div>
              </div>
            ) : <p className="muted small">القرار للمدير فقط — يمكنك المراجعة.</p>}
          </>) : <Empty text="جارٍ التحميل…" />}
        </Modal>
      ) : null}
    </Page>
  );
}
