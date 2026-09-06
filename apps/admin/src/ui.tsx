import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, session, ApiError } from './api';

/* ---------- الجلسة ---------- */
export interface Me { id: number; displayName: string; roles: string[]; phone: string | null; email: string | null }
export const STAFF = ['content_reviewer', 'support', 'finance', 'admin', 'super_admin'];
export function useMe() { return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), enabled: !!session.refresh, retry: false }); }
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

/* ---------- عناصر ---------- */
export const Badge = ({ tone = '', children }: { tone?: string; children: ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="modal-bg" onClick={onClose}><div className="modal" role="dialog" aria-modal onClick={e => e.stopPropagation()}><div className="row between" style={{ marginBottom: 14 }}><h2 style={{ margin: 0 }}>{title}</h2><button className="btn ghost sm" onClick={onClose}>إغلاق</button></div>{children}{footer ? <div className="row end" style={{ marginTop: 16 }}>{footer}</div> : null}</div></div>;
}
export const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className="field"><label>{label}</label>{children}</div>;
export const Empty = ({ text = 'لا بيانات' }: { text?: string }) => <div className="empty">{text}</div>;
export function Page({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return <div><div className="head"><div><h1>{title}</h1>{sub ? <div className="muted small">{sub}</div> : null}</div>{actions}</div>{children}</div>;
}
export const STATUS_TONE: Record<string, string> = {
  pending: 'warning', under_review: 'info', verified: 'success', rejected: 'danger', suspended: 'danger',
  pending_review: 'warning', approved: 'info', published: 'success', draft: '', archived: '',
  pending_payment: 'warning', confirmed: 'info', in_progress: 'brand', completed: 'success', cancelled_by_student: '', cancelled_by_teacher: 'danger', no_show: 'danger', disputed: 'warning', expired: '',
  paid: 'success', failed: 'danger', refunded: '', partially_refunded: '', cancelled: '', open: 'warning', reviewing: 'info', resolved: 'success', dismissed: '', active: 'success',
};
export const AR: Record<string, string> = {
  pending: 'قيد الانتظار', under_review: 'قيد المراجعة', verified: 'معتمد', rejected: 'مرفوض', suspended: 'موقوف',
  pending_review: 'بانتظار المراجعة', approved: 'مقبول', published: 'منشور', draft: 'مسودّة', archived: 'مؤرشف',
  pending_payment: 'بانتظار الدفع', confirmed: 'مؤكّدة', in_progress: 'جارية', completed: 'مكتملة', cancelled_by_student: 'ألغاها الطالب', cancelled_by_teacher: 'ألغاها المعلّم', no_show: 'لم تُحضَر', disputed: 'نزاع', expired: 'منتهية',
  paid: 'مدفوع', failed: 'فشل', refunded: 'مسترجَع', partially_refunded: 'مسترجَع جزئياً', cancelled: 'ملغى', open: 'مفتوح', reviewing: 'قيد المراجعة', resolved: 'محلول', dismissed: 'مرفوض', active: 'نشط',
  book: 'كتاب', course: 'دورة', lesson: 'حصة', package: 'باقة', student: 'طالب', parent: 'وليّ أمر', teacher: 'معلّم', content_reviewer: 'مراجع محتوى', support: 'دعم', finance: 'مالية', admin: 'مدير', super_admin: 'مدير عام',
};
export const ar = (k: string) => AR[k] ?? k;
