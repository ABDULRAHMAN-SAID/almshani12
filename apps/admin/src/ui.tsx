import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LearnerRef, PageMeta } from '@manassah/shared';
import { api, session, ApiError } from './api';

/* ---------- الجلسة ---------- */
export interface Me { id: number; displayName: string; roles: string[]; phone: string | null; email: string | null }
export const STAFF = ['content_reviewer', 'support', 'finance', 'admin', 'super_admin'];
export const ROLES = ['student', 'parent', 'teacher', 'content_reviewer', 'support', 'finance', 'admin', 'super_admin'];
export function useMe() { return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), enabled: !!session.refresh, retry: false }); }
/** admin/super_admin يمرّان دائماً (كما في requireRole في الخادم) */
export const can = (me: Me | undefined, ...roles: string[]) => !!me && me.roles.some(r => r === 'admin' || r === 'super_admin' || roles.includes(r));
export const isSuper = (me: Me | undefined) => !!me?.roles.includes('super_admin');

/* ---------- تنبيهات ---------- */
const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const id = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(id); }, [msg]);
  return <ToastCtx.Provider value={setMsg}>{children}{msg ? <div className="toast" role="status">{msg}</div> : null}</ToastCtx.Provider>;
}
export const errMsg = (e: unknown) => e instanceof ApiError ? e.message : 'تعذّر إكمال العملية';

/* ---------- عناصر أساسية ---------- */
export const Badge = ({ tone = '', children, title }: { tone?: string; children: ReactNode; title?: string }) => <span className={`badge ${tone}`} title={title}>{children}</span>;
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="modal-bg" onClick={onClose}><div className="modal" style={wide ? { width: 'min(960px, 100%)' } : undefined} role="dialog" aria-modal onClick={e => e.stopPropagation()}><div className="row between" style={{ marginBottom: 14 }}><h2 style={{ margin: 0 }}>{title}</h2><button className="btn ghost sm" onClick={onClose}>إغلاق</button></div>{children}{footer ? <div className="row end" style={{ marginTop: 16 }}>{footer}</div> : null}</div></div>;
}
/** لوحة جانبية للنماذج — تُغلق بـ Esc أو بالنقر خارجها */
export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <><div className="drawer-bg" onClick={onClose} /><aside className="drawer" role="dialog" aria-modal><div className="dh"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose}>إغلاق</button></div><div className="db">{children}</div>{footer ? <div className="df">{footer}</div> : null}</aside></>;
}
export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => <div className="field"><label>{label}</label>{children}{hint ? <span className="muted small">{hint}</span> : null}</div>;
export const Empty = ({ text = 'لا بيانات' }: { text?: string }) => <div className="empty">{text}</div>;
export function Page({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return <div><div className="head"><div><h1>{title}</h1>{sub ? <div className="muted small">{sub}</div> : null}</div>{actions}</div>{children}</div>;
}
export const Avatar = ({ url, name, size = 32 }: { url?: string | null; name: string; size?: number }) => (
  <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} title={name}>{url ? <img src={url} alt="" /> : (name || '؟').trim().charAt(0)}</span>
);

/* ---------- روابط الأشخاص والمعلّمين ---------- */
export const PersonLink = ({ id, name }: { id: number; name?: string | null }) => <Link to={`/users/${id}`}>{name || `#${id}`}</Link>;
export const TeacherLink = ({ id, name }: { id: number; name?: string | null }) => <Link to={`/teachers/${id}`}>{name || `#${id}`}</Link>;
/** المتعلّم كما يراه الطاقم: صورة/حرف + الاسم + الصف — لا شيء آخر (LearnerRef فقط) */
export const LearnerChip = ({ learner, size = 22 }: { learner: LearnerRef | null | undefined; size?: number }) => learner
  ? <span className="lchip"><Avatar url={learner.avatarUrl} name={learner.displayName} size={size} />{learner.displayName}{learner.gradeName ? <span className="g">· {learner.gradeName}</span> : null}</span>
  : <span className="muted small">—</span>;

/* ---------- تبويبات ---------- */
export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; badge?: number | string | null }[]; value: string; onChange: (k: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(t => <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>{t.label}{t.badge ? <span className="count">{t.badge}</span> : null}</button>)}</div>;
}

/* ---------- جدول بيانات مع ترقيم «N من M» ---------- */
export type Column<T> = { key: string; label: ReactNode; render: (row: T, i: number) => ReactNode; className?: string; hide?: boolean };
export function DataTable<T>({ columns, rows, meta, onPage, loading, empty = 'لا بيانات', rowKey, rowClass, expand }: {
  columns: Column<T>[]; rows: T[] | undefined; meta?: PageMeta | null; onPage?: (page: number) => void; loading?: boolean; empty?: string;
  rowKey?: (row: T, i: number) => string | number; rowClass?: (row: T) => string; expand?: (row: T) => ReactNode;
}) {
  const [open, setOpen] = useState<Set<string | number>>(new Set());
  const cols = columns.filter(c => !c.hide);
  const key = (r: T, i: number) => rowKey ? rowKey(r, i) : (r as { id?: number }).id ?? i;
  const toggle = (k: string | number) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  if (!rows?.length) return <Empty text={loading ? 'جارٍ التحميل…' : empty} />;
  return (
    <div className="tbl">
      <table>
        <thead><tr>{expand ? <th style={{ width: 36 }} /> : null}{cols.map(c => <th key={c.key} className={c.className}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => { const k = key(r, i); const isOpen = open.has(k); return (
          <RowGroup key={k}>
            <tr className={rowClass?.(r)}>{expand ? <td><button className="btn ghost sm" aria-expanded={isOpen} onClick={() => toggle(k)}>{isOpen ? '−' : '+'}</button></td> : null}{cols.map(c => <td key={c.key} className={c.className}>{c.render(r, i)}</td>)}</tr>
            {expand && isOpen ? <tr><td colSpan={cols.length + 1} style={{ background: 'var(--bg)' }}>{expand(r)}</td></tr> : null}
          </RowGroup>
        ); })}</tbody>
      </table>
      {meta ? <div className="pager"><span className="num">{meta.total} إجمالاً</span>{meta.pages > 1 ? <span className="row"><button className="btn secondary sm" disabled={meta.page <= 1} onClick={() => onPage?.(meta.page - 1)}>السابق</button><span className="num">{meta.page} من {meta.pages}</span><button className="btn secondary sm" disabled={meta.page >= meta.pages} onClick={() => onPage?.(meta.page + 1)}>التالي</button></span> : null}</div> : null}
    </div>
  );
}
const RowGroup = ({ children }: { children: ReactNode }) => <>{children}</>;

/* ---------- حوار تأكيد بديل لـ window.prompt / confirm ---------- */
export type ConfirmField = { key: string; label: string; type?: 'text' | 'textarea' | 'select' | 'number' | 'checkbox'; options?: { value: string; label: string }[]; initial?: string; required?: boolean; placeholder?: string; hint?: string };
export type ConfirmOpts = {
  title: string; body?: ReactNode; reasonRequired?: boolean; reasonLabel?: string; minLength?: number; fields?: ConfirmField[]; danger?: boolean; confirmLabel?: string;
  /** نصّ يجب كتابته حرفيّاً للتأكيد (مثلاً رقم المستخدم عند الحذف) */
  typed?: string;
};
export function ConfirmDialog({ title, body, reasonRequired, reasonLabel = 'السبب (يُسجَّل)', minLength = 3, fields = [], danger, confirmLabel = 'تأكيد', typed, onConfirm, onClose, busy }: ConfirmOpts & { onConfirm: (values: Record<string, string>) => void; onClose: () => void; busy?: boolean }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, f.initial ?? (f.type === 'checkbox' ? 'false' : f.type === 'select' ? (f.options?.[0]?.value ?? '') : '')])));
  const [reason, setReason] = useState('');
  const [typedV, setTypedV] = useState('');
  const ok = (!reasonRequired || reason.trim().length >= minLength) && fields.every(f => !f.required || (v[f.key] ?? '').trim()) && (!typed || typedV.trim() === typed);
  const set = (k: string, val: string) => setV(s => ({ ...s, [k]: val }));
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn secondary" onClick={onClose}>إلغاء</button><button className={`btn ${danger ? 'danger' : ''}`} disabled={!ok || busy} onClick={() => onConfirm({ ...v, reason: reason.trim(), typed: typedV })}>{confirmLabel}</button></>}>
      {body ? <div style={{ marginBottom: 12 }}>{typeof body === 'string' ? <p className="muted" style={{ margin: 0 }}>{body}</p> : body}</div> : null}
      {fields.map(f => <Field key={f.key} label={f.label} hint={f.hint}>{
        f.type === 'textarea' ? <textarea value={v[f.key] ?? ''} placeholder={f.placeholder} onChange={e => set(f.key, e.target.value)} />
        : f.type === 'select' ? <select value={v[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}>{(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        : f.type === 'checkbox' ? <label className="row"><input type="checkbox" style={{ width: 18, minHeight: 0 }} checked={v[f.key] === 'true'} onChange={e => set(f.key, e.target.checked ? 'true' : 'false')} />{f.placeholder ?? 'نعم'}</label>
        : <input value={v[f.key] ?? ''} placeholder={f.placeholder} inputMode={f.type === 'number' ? 'decimal' : undefined} onChange={e => set(f.key, e.target.value)} autoFocus={!reasonRequired} />
      }</Field>)}
      {reasonRequired ? <Field label={`${reasonLabel} — ${minLength} أحرف على الأقل`}><textarea value={reason} onChange={e => setReason(e.target.value)} autoFocus /></Field> : null}
      {typed ? <Field label={`اكتب «${typed}» للتأكيد`}><input value={typedV} onChange={e => setTypedV(e.target.value)} className="mono" /></Field> : null}
    </Modal>
  );
}
type Pending = { opts: ConfirmOpts; resolve: (v: Record<string, string> | null) => void };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<Record<string, string> | null>>(async () => null);
/** confirm(...) يعيد القيم المدخلة أو null عند الإلغاء — بديل واحد لكل prompt/confirm في اللوحة */
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null);
  const confirm = (opts: ConfirmOpts) => new Promise<Record<string, string> | null>(resolve => setP({ opts, resolve }));
  const done = (v: Record<string, string> | null) => { p?.resolve(v); setP(null); };
  return <ConfirmCtx.Provider value={confirm}>{children}{p ? <ConfirmDialog {...p.opts} onConfirm={v => done(v)} onClose={() => done(null)} /> : null}</ConfirmCtx.Provider>;
}

/* ---------- مؤشّرات ورسوم بيانية (SVG مضمّن، بلا مكتبات) ---------- */
export function Kpi({ label, value, delta, to, tone }: { label: string; value: ReactNode; delta?: ReactNode; to?: string; tone?: 'warn' | 'danger' | 'ok' }) {
  const long = typeof value === 'string' && value.length > 9;
  const inner = <><div className={`v num ${long ? 'long' : ''}`}>{value}</div><div className="l">{label}</div>{delta ? <div className="d">{delta}</div> : null}</>;
  return to ? <Link className={`kpi ${tone ?? ''}`} to={to}>{inner}</Link> : <div className={`kpi ${tone ?? ''}`}>{inner}</div>;
}
export type Series = { label: string; values: number[]; color?: string };
const COLORS = ['var(--chart-1)', 'var(--chart-2)'];
const fmtN = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(3);
const shortDay = (d: string) => d.slice(5).replace('-', '/');
function useChartGeom(labels: string[], series: Series[], height: number) {
  const W = 600, padL = 34, padR = 8, padT = 10, padB = 20;
  const max = Math.max(1, ...series.flatMap(s => s.values));
  const n = Math.max(1, labels.length);
  const x = (i: number) => padL + (n === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1));
  const y = (v: number) => padT + (height - padT - padB) * (1 - v / max);
  return { W, H: height, padL, padR, padT, padB, max, n, x, y };
}
function Legend({ series, hover, labels }: { series: Series[]; hover: number | null; labels: string[] }) {
  return <div className="legend">{series.map((s, i) => <span key={s.label}><i style={{ background: s.color ?? COLORS[i % COLORS.length] }} />{s.label}{hover !== null && s.values[hover] !== undefined ? <b className="num" style={{ marginInlineStart: 6 }}>{fmtN(s.values[hover]!)}</b> : null}</span>)}{hover !== null ? <span className="num muted">{labels[hover]}</span> : null}</div>;
}
/** خطوط رفيعة لسلسلة أو سلسلتين مع تمرير يُظهر القيم */
export function Sparkline({ labels, series, height = 120 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const g = useChartGeom(labels, series, height);
  const step = (g.W - g.padL - g.padR) / Math.max(1, g.n - 1);
  return (
    <div className="chart" dir="ltr">
      <div dir="rtl"><Legend series={series} hover={hover} labels={labels} /></div>
      <svg viewBox={`0 0 ${g.W} ${g.H}`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map(f => <line key={f} x1={g.padL} x2={g.W - g.padR} y1={g.y(g.max * f)} y2={g.y(g.max * f)} stroke="var(--border)" strokeWidth={1} />)}
        {[0, 1].map(f => <text key={f} x={g.padL - 6} y={g.y(g.max * f) + 4} fontSize={10} fill="var(--text-3)" textAnchor="end">{fmtN(g.max * f)}</text>)}
        {labels.map((l, i) => (i === 0 || i === g.n - 1 || (g.n <= 14 && i % 2 === 0) || (g.n > 14 && i % Math.ceil(g.n / 7) === 0)) ? <text key={l} x={g.x(i)} y={g.H - 4} fontSize={10} fill="var(--text-3)" textAnchor="middle">{shortDay(l)}</text> : null)}
        {series.map((s, si) => <polyline key={s.label} fill="none" stroke={s.color ?? COLORS[si % COLORS.length]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={labels.map((_, i) => `${g.x(i)},${g.y(s.values[i] ?? 0)}`).join(' ')} />)}
        {hover !== null ? <><line x1={g.x(hover)} x2={g.x(hover)} y1={g.padT} y2={g.H - g.padB} stroke="var(--text-3)" strokeDasharray="3 3" />{series.map((s, si) => <circle key={s.label} cx={g.x(hover)} cy={g.y(s.values[hover] ?? 0)} r={4} fill={s.color ?? COLORS[si % COLORS.length]} stroke="var(--card)" strokeWidth={2} />)}</> : null}
        {labels.map((_, i) => <rect key={i} x={g.x(i) - step / 2} y={0} width={step} height={g.H} fill="transparent" onMouseEnter={() => setHover(i)} />)}
      </svg>
    </div>
  );
}
/** أعمدة مجمَّعة (سلسلة أو سلسلتان) بفاصل ٢px وقمم مدوّرة */
export function BarSeries({ labels, series, height = 140 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const g = useChartGeom(labels, series, height);
  const slot = (g.W - g.padL - g.padR) / g.n, inner = slot * 0.7, bw = Math.max(2, (inner - 2 * (series.length - 1)) / series.length);
  return (
    <div className="chart" dir="ltr">
      <div dir="rtl"><Legend series={series} hover={hover} labels={labels} /></div>
      <svg viewBox={`0 0 ${g.W} ${g.H}`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map(f => <line key={f} x1={g.padL} x2={g.W - g.padR} y1={g.y(g.max * f)} y2={g.y(g.max * f)} stroke="var(--border)" strokeWidth={1} />)}
        {[0, 1].map(f => <text key={f} x={g.padL - 6} y={g.y(g.max * f) + 4} fontSize={10} fill="var(--text-3)" textAnchor="end">{fmtN(g.max * f)}</text>)}
        {labels.map((l, i) => { const x0 = g.padL + i * slot + (slot - inner) / 2; return (
          <g key={l} onMouseEnter={() => setHover(i)}>
            <rect x={g.padL + i * slot} y={g.padT} width={slot} height={g.H - g.padT - g.padB} fill={hover === i ? 'var(--bg-2)' : 'transparent'} />
            {series.map((s, si) => { const v = s.values[i] ?? 0; const h = Math.max(0, g.y(0) - g.y(v)); return <rect key={s.label} x={x0 + si * (bw + 2)} y={g.y(v)} width={bw} height={h} rx={Math.min(3, bw / 2)} fill={s.color ?? COLORS[si % COLORS.length]}><title>{`${l} · ${s.label}: ${fmtN(v)}`}</title></rect>; })}
            {(i === 0 || i === g.n - 1 || (g.n <= 14 && i % 2 === 0) || (g.n > 14 && i % Math.ceil(g.n / 7) === 0)) ? <text x={g.padL + i * slot + slot / 2} y={g.H - 4} fontSize={10} fill="var(--text-3)" textAnchor="middle">{shortDay(l)}</text> : null}
          </g>
        ); })}
      </svg>
    </div>
  );
}
/** أشرطة أفقية بلون واحد مع قيم مباشرة */
export function HBars({ items, format = fmtN }: { items: { label: ReactNode; value: number; key?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map(i => i.value));
  if (!items.length) return <Empty text="لا بيانات" />;
  return <div className="hbars">{items.map((it, i) => <div className="r" key={it.key ?? i}><span>{it.label}</span><span className="bar" title={format(it.value)}><i style={{ width: `${(it.value / max) * 100}%` }} /></span><span className="num small">{format(it.value)}</span></div>)}</div>;
}

/* ---------- المنهج (للنماذج التي تحتاج صفوفاً ومواد) ---------- */
export type CatalogTreeT = { countries: { id: number; code: string; name: string }[]; curriculums: { id: number; countryId: number; name: string }[]; grades: { id: number; curriculumId: number; name: string; order: number }[]; semesters: { id: number; curriculumId: number; name: string; order: number }[]; subjects: { id: number; curriculumId: number; name: string; slug: string; colorKey: string }[] };
export const useCatalog = () => useQuery({ queryKey: ['catalog'], queryFn: () => api.get<CatalogTreeT>('/catalog/tree'), staleTime: 300_000 });
export const useDebounced = <T,>(v: T, ms = 300) => { const [d, setD] = useState(v); useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]); return d; };

/* ---------- ألوان ونصوص الحالات ---------- */
export const STATUS_TONE: Record<string, string> = {
  pending: 'warning', under_review: 'info', verified: 'success', rejected: 'danger', suspended: 'danger', deleted: 'danger',
  pending_review: 'warning', approved: 'info', published: 'success', draft: '', archived: '',
  pending_payment: 'warning', confirmed: 'info', in_progress: 'brand', completed: 'success', cancelled_by_student: '', cancelled_by_teacher: 'danger', no_show: 'danger', disputed: 'warning', expired: '',
  paid: 'success', failed: 'danger', refunded: '', partially_refunded: '', cancelled: '', open: 'warning', reviewing: 'info', resolved: 'success', dismissed: '', active: 'success',
  submitted: 'warning', accepted: 'success', hidden: 'danger', available: 'success', reversed: 'danger', topup: 'success', bonus: 'success', refund: 'info', purchase: '', adjustment: 'warning',
};
export const AR: Record<string, string> = {
  pending: 'قيد الانتظار', under_review: 'قيد المراجعة', verified: 'معتمد', rejected: 'مرفوض', suspended: 'موقوف', deleted: 'محذوف',
  pending_review: 'بانتظار المراجعة', approved: 'مقبول', published: 'منشور', draft: 'مسودّة', archived: 'مؤرشف',
  pending_payment: 'بانتظار الدفع', confirmed: 'مؤكّدة', in_progress: 'جارية', completed: 'مكتملة', cancelled_by_student: 'ألغاها الطالب', cancelled_by_teacher: 'ألغاها المعلّم', no_show: 'لم تُحضَر', disputed: 'نزاع', expired: 'منتهية',
  paid: 'مدفوع', failed: 'فشل', refunded: 'مسترجَع', partially_refunded: 'مسترجَع جزئياً', cancelled: 'ملغى', open: 'مفتوح', reviewing: 'قيد المراجعة', resolved: 'محلول', dismissed: 'مرفوض', active: 'نشط',
  book: 'كتاب', course: 'دورة', lesson: 'حصة', package: 'باقة', subscription: 'اشتراك', student: 'طالب', parent: 'وليّ أمر', teacher: 'معلّم', content_reviewer: 'مراجع محتوى', support: 'دعم', finance: 'مالية', admin: 'مدير', super_admin: 'مدير عام',
  self: 'ذاتي', child: 'ابن/ابنة', learner: 'متعلّم',
  topup: 'شحن', purchase: 'شراء', refund: 'استرجاع', adjustment: 'تعديل', bonus: 'مكافأة',
  free: 'مجاني', gift: 'هدية',
  submitted: 'مُرسَل', accepted: 'مقبول', hidden: 'مخفي', available: 'متاح', reversed: 'معكوس',
  id: 'هوية', degree: 'شهادة جامعية', certificate: 'شهادة', photo: 'صورة', other: 'أخرى',
  user: 'مستخدم', message: 'رسالة', review: 'تقييم', male: 'ذكر', female: 'أنثى',
  manual: 'تحويل بنكي', wallet: 'محفظة', mock: 'تجريبي', card: 'بطاقة', unknown: 'غير محدّد',
};
export const ar = (k: string | null | undefined) => (k ? AR[k] ?? k : '—');
export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
