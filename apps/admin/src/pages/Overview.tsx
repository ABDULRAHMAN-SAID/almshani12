import { useQuery } from '@tanstack/react-query';
import { api, money } from '../api';
import { Page, ar } from '../ui';

/** أرقام حقيقية من قاعدة البيانات — لا تجميل */
export default function Overview() {
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get<any>('/admin/overview') });
  const d = q.data;
  if (!d) return <Page title="نظرة عامة"><div className="empty">{q.isError ? 'تعذّر التحميل' : 'جارٍ التحميل…'}</div></Page>;
  const stat = (v: string | number, l: string) => <div className="stat" key={l}><div className="v">{v}</div><div className="l">{l}</div></div>;
  return (
    <Page title="نظرة عامة" sub="محدَّثة كل دقيقة">
      <h2>قوائم العمل</h2>
      <div className="grid grid-4" style={{ marginBottom: 20 }}>{stat(d.queues.teacherApplications, 'طلبات معلّمين')}{stat(d.queues.contentReview, 'محتوى بانتظار المراجعة')}{stat(d.queues.manualPayments, 'تحويلات بنكية')}{stat(d.queues.payouts, 'طلبات سحب')}</div>
      <h2>هذا الشهر</h2>
      <div className="grid grid-4" style={{ marginBottom: 20 }}>{stat(money(d.revenue.month), 'مبيعات مدفوعة')}{stat(money(d.revenue.commissionMonth), 'عمولة المنصّة')}{stat(money(d.revenue.refundsMonth), 'استرجاعات')}{stat(d.users.newThisMonth, 'مستخدمون جدد')}</div>
      <h2>المنصّة</h2>
      <div className="grid grid-4">{stat(d.users.total, 'مستخدم نشط')}{stat(d.users.students, 'طالب')}{stat(d.bookings.today, 'حصص اليوم')}{stat(d.reports ?? d.queues.reports, 'بلاغات مفتوحة')}</div>
      <div className="card" style={{ marginTop: 20 }}><h3>المعلّمون حسب الحالة</h3><div className="row">{Object.entries(d.teachers as Record<string, number>).map(([k, v]) => <span key={k} className="badge">{ar(k)}: {v}</span>)}{!Object.keys(d.teachers).length ? <span className="muted">لا معلّمين بعد</span> : null}</div><div className="muted small" style={{ marginTop: 8 }}>حجوزات بانتظار الدفع: {d.bookings.pendingPayment} · نزاعات: {d.bookings.disputed}</div></div>
    </Page>
  );
}
