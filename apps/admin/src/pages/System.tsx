import { Fragment, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, when } from '../api';
import { Page, Badge, useToast, errMsg } from '../ui';
import type { SystemInfo, IntegrationItem, IntegrationStatus, SystemCheckResult, SystemBackupResult } from '@manassah/shared';

/** صفحة README في المستودع — الروابط «الدليل» تشير إلى عناوين قسم «ربط الخدمات» */
const DOCS_BASE = (import.meta.env.VITE_DOCS_URL as string | undefined) || 'https://github.com/ABDULRAHMAN-SAID/almshani12/blob/main/README.md';
const STATUS: Record<IntegrationStatus, { tone: string; label: string }> = { ready: { tone: 'success', label: 'جاهز' }, partial: { tone: 'warning', label: 'ناقص' }, off: { tone: '', label: 'غير مفعّل' } };
const kb = (n: number) => n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`;

/** شرائح الملخّص: جاهز n · ناقص n · غير مفعّل n — تُستخدم هنا وفي بطاقة الإعدادات */
export function SummaryChips({ s }: { s: SystemInfo['summary'] }) {
  return <span className="chips">
    <Badge tone="success">جاهز <b className="num">{s.ready}</b></Badge>
    <Badge tone="warning">ناقص <b className="num">{s.partial}</b></Badge>
    <Badge>غير مفعّل <b className="num">{s.off}</b></Badge>
    <span className="muted small num" style={{ alignSelf: 'center' }}>من {s.total}</span>
  </span>;
}

/** صف خدمة: الاسم · الحالة · التفاصيل · المتغيّرات الناقصة · نتيجة الفحص · الدليل */
function Row({ it, check }: { it: IntegrationItem; check?: SystemCheckResult[string] }) {
  const st = STATUS[it.status];
  return (
    <div className="irow">
      <div className="irow-main">
        <div className="row" style={{ gap: 8 }}>
          <b>{it.label}</b>
          <Badge tone={st.tone}>{st.label}</Badge>
          {check ? <Badge tone={check.ok ? 'success' : 'danger'} title={check.detail}>{check.ok ? '✅' : '❌'} <span className="num">{check.ms} م.ث</span></Badge> : null}
        </div>
        {it.detail ? <div className="muted small">{it.detail}</div> : null}
        {check && (!check.ok || check.detail) ? <div className={`small ${check.ok ? 'muted' : 'error'}`}>{check.detail}</div> : null}
        {it.missing.length ? <div className="chips"><span className="muted small">ينقص:</span>{it.missing.map(m => <code key={m} className="env">{m}</code>)}</div> : null}
      </div>
      <a className="small" href={`${DOCS_BASE}#${it.docs}`} target="_blank" rel="noreferrer">الدليل</a>
    </div>
  );
}

/** الربط والخدمات: حالة كل تكامل كما يراها الخادم (بلا أسرار) مع فحص اتصال فعلي ونسخ احتياطي فوري */
export default function System() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['adm-system'], queryFn: () => api.get<SystemInfo>('/admin/system'), staleTime: 60_000 });
  const [checks, setChecks] = useState<SystemCheckResult>({});
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () => api.post<SystemCheckResult>('/admin/system/check', {}),
    onSuccess: r => { setChecks(r); setCheckedAt(new Date().toISOString()); const bad = Object.values(r).filter(x => !x.ok).length; toast(bad ? `فشل ${bad} من ${Object.keys(r).length} فحوصات` : 'كل الفحوصات ناجحة'); qc.invalidateQueries({ queryKey: ['adm-system'] }); },
    onError: e => toast(errMsg(e)),
  });
  const backup = useMutation({
    mutationFn: () => api.post<SystemBackupResult>('/admin/system/backup', {}),
    onSuccess: r => { toast(`أُنشئت النسخة (${kb(r.bytes)})`); qc.invalidateQueries({ queryKey: ['adm-system'] }); },
    onError: e => toast(errMsg(e)),
  });
  const s = q.data;
  const deploy: [string, ReactNode][] = s ? [
    ['الرابط العام', <span className="num" dir="ltr">{s.publicUrl || '—'}</span>],
    ['النطاق', s.deploy.domain ? <span className="num" dir="ltr">{s.deploy.domain}</span> : <span className="muted">غير محدّد — DOMAIN</span>],
    ['صورة الحاوية', s.deploy.image ? <code className="env">{s.deploy.image}</code> : <span className="muted">—</span>],
    ['إصدار القاعدة', <span className="num">{s.schemaVersion}</span>],
    ['البيئة', <span className="num">{s.env}</span>],
    ['آخر نسخة احتياطية', <>{when(s.backups.last)} <span className="muted small num">· {s.backups.count} نسخة في </span><code className="env">{s.backups.dir}</code></>],
  ] : [];
  return (
    <Page title="الربط والخدمات" sub="حالة كل خدمة كما يراها الخادم — تُضبط من متغيّرات البيئة أو أسرار المستودع، ولا تُعرض أسرار هنا" actions={<span className="row">
      <button className="btn secondary" disabled={backup.isPending || !s} onClick={() => backup.mutate()}>{backup.isPending ? 'جارٍ النسخ…' : 'نسخة احتياطية الآن'}</button>
      <button className="btn" disabled={check.isPending || !s} onClick={() => check.mutate()}>{check.isPending ? 'جارٍ الفحص…' : 'فحص الاتصال الآن'}</button>
    </span>}>
      {q.isLoading ? <div className="empty">جارٍ التحميل…</div> : q.isError || !s ? <p className="error">{errMsg(q.error)}</p> : (<>
        <div className="row between" style={{ marginBottom: 14 }}>
          <SummaryChips s={s.summary} />
          {checkedAt ? <span className="muted small">آخر فحص: {when(checkedAt)}</span> : <span className="muted small">الفحص يلمس الخدمات الخارجية فعلياً — مرة كل ١٠ ثوانٍ</span>}
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>النشر</h2>
          <dl className="kv">{deploy.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        </div>
        <div className="grid grid-2">
          {s.integrations.map(g => {
            const ready = g.items.filter(i => i.status === 'ready').length;
            return <div className="card" key={g.group}>
              <div className="row between"><h2 style={{ margin: 0 }}>{g.label}</h2><span className="muted small num">{ready} / {g.items.length} جاهز</span></div>
              <div className="irows">{g.items.map(it => <Row key={it.id} it={it} check={checks[it.id]} />)}</div>
            </div>;
          })}
        </div>
      </>)}
    </Page>
  );
}
