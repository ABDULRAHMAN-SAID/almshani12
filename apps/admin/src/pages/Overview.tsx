import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Overview as OverviewT } from '@manassah/shared';
import { api, money, when } from '../api';
import { Page, Kpi, Sparkline, BarSeries, HBars, Badge, TeacherLink, Empty, ErrorState, STATUS_TONE, ar } from '../ui';

const RANGES = [7, 14, 30, 90] as const;
const tm = (iso: string) => new Intl.DateTimeFormat('ar-u-nu-latn', { timeStyle: 'short', timeZone: 'Asia/Muscat' }).format(new Date(iso));

/** النظرة الحيّة: أرقام حقيقية من قاعدة البيانات تُحدَّث كل ٣٠ ثانية — الآن، قوائم العمل، المال، المستخدمون، والرسوم */
export default function Overview() {
  const [days, setDays] = useState<number>(14);
  const [showLive, setShowLive] = useState(false);
  const q = useQuery({ queryKey: ['overview', days], queryFn: () => api.get<OverviewT>('/admin/overview', { days }), refetchInterval: 30_000 });
  const d = q.data;
  if (!d) return <Page title="نظرة عامة">{q.isError ? <ErrorState error={q.error} /> : <Empty text="جارٍ التحميل…" />}</Page>;
  const s = d.series, br = d.breakdown, l = d.live;
  const verified = d.teachers.verified ?? 0;
  const byType = (['lesson', 'book', 'course', 'package', 'subscription'] as const).map(k => ({ key: k, label: ar(k), value: br.revenueByItemType[k] ?? 0 }));
  return (
    <Page title="نظرة عامة" sub={`محدَّثة ${when(d.generatedAt)} · تتجدّد كل ٣٠ ثانية`} actions={<div className="range">{RANGES.map(r => <button key={r} className={`chip ${days === r ? 'on' : ''}`} onClick={() => setDays(r)}>{r} يوماً</button>)}</div>}>
      <h2>الآن</h2>
      <div className="kpis">
        <Kpi label="حصص جارية" value={l.lessonsInProgress} to="/bookings?status=in_progress" tone={l.lessonsInProgress ? 'ok' : undefined} />
        <Kpi label="تبدأ خلال ساعة" value={l.lessonsNextHour} to="/bookings?status=confirmed" />
        <Kpi label="أجهزة متصلة" value={l.connectedSockets} />
        <Kpi label="حجوزات بانتظار الدفع" value={l.pendingPaymentBookings} to="/bookings?status=pending_payment" tone={l.pendingPaymentBookings ? 'warn' : undefined} />
        <Kpi label="نزاعات مفتوحة" value={l.openDisputes} to="/bookings?status=disputed" tone={l.openDisputes ? 'danger' : undefined} />
        <Kpi label="بلاغات مفتوحة" value={l.openReports} to="/reports?status=open" tone={l.openReports ? 'warn' : undefined} />
        <Kpi label="مبيعات اليوم" value={money(l.gmvToday)} to="/orders?status=paid" />
        <Kpi label="استرجاعات اليوم" value={money(l.refundsToday)} />
        <Kpi label="مستخدمون جدد اليوم" value={d.users.newToday} to="/users" />
        <Kpi label="نشطون آخر ٢٤ ساعة" value={d.users.activeUsers24h} />
      </div>
      {l.inProgress.length ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <button className="btn ghost sm" onClick={() => setShowLive(v => !v)}>{showLive ? 'إخفاء' : 'عرض'} الحصص الجارية ({l.inProgress.length})</button>
          {showLive ? <table style={{ marginTop: 8 }}><thead><tr><th>#</th><th>المعلّم</th><th>المتعلّم</th><th>الوقت</th></tr></thead><tbody>{l.inProgress.map(b => <tr key={b.id}><td className="num">{b.id}</td><td>{b.teacherName}</td><td>{b.learnerName}</td><td className="num">{tm(b.startsAt)} – {tm(b.endsAt)}</td></tr>)}</tbody></table> : null}
        </div>
      ) : null}

      <h2>قوائم العمل</h2>
      <div className="kpis">
        <Kpi label="طلبات معلّمين" value={d.queues.teacherApplications} to="/teachers?status=pending" tone={d.queues.teacherApplications ? 'warn' : undefined} />
        <Kpi label="محتوى بانتظار المراجعة" value={d.queues.contentReview} to="/content" tone={d.queues.contentReview ? 'warn' : undefined} />
        <Kpi label="تحويلات بنكية" value={d.queues.manualPayments} to="/orders?status=pending" tone={d.queues.manualPayments ? 'warn' : undefined} />
        <Kpi label="طلبات سحب" value={d.queues.payouts} to="/payouts" tone={d.queues.payouts ? 'warn' : undefined} />
        <Kpi label="مستندات بانتظار المراجعة" value={d.queues.pendingDocuments} to="/teachers?status=" tone={d.queues.pendingDocuments ? 'warn' : undefined} />
      </div>

      <h2>المال</h2>
      {/* الصفّ الأول أرقام منذ بداية الشهر؛ الثاني أرصدة لحظية (مجاميع المحافظ وأرصدة المعلّمين بلا فلتر زمني) */}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <Kpi label="مبيعات مدفوعة (هذا الشهر)" value={money(d.revenue.month)} /><Kpi label="عمولة المنصّة (هذا الشهر)" value={money(d.revenue.commissionMonth)} /><Kpi label="استرجاعات (هذا الشهر)" value={money(d.revenue.refundsMonth)} />
      </div>
      <div className="kpis">
        <Kpi label="أرصدة المحافظ — التزام (الآن)" value={money(l.walletLiability)} /><Kpi label="مستحقّ للمعلّمين — متاح (الآن)" value={money(l.teacherPayable.available)} to="/payouts" /><Kpi label="مستحقّ للمعلّمين — معلّق (الآن)" value={money(l.teacherPayable.pending)} />
      </div>

      <h2>المستخدمون</h2>
      <div className="kpis">
        <Kpi label="حساب نشط" value={d.users.total} to="/users" /><Kpi label="طالب" value={d.users.students} to="/users?role=student" /><Kpi label="وليّ أمر" value={d.users.parents} to="/users?role=parent" />
        <Kpi label="متعلّم" value={d.users.learners} delta={d.users.learnersByGrade.length ? d.users.learnersByGrade.map(g => `${g.gradeName}: ${g.count}`).join(' · ') : undefined} />
        <Kpi label="معلّم معتمد" value={verified} to="/teachers?status=verified" /><Kpi label="مستخدمون جدد هذا الشهر" value={d.users.newThisMonth} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card"><h3>المبيعات مقابل الاسترجاعات (ر.ع)</h3><BarSeries labels={s.days} series={[{ label: 'مبيعات', values: s.revenue }, { label: 'استرجاعات', values: s.refunds }]} /></div>
        <div className="card"><h3>الحجوزات والمكتمل</h3><Sparkline labels={s.days} series={[{ label: 'حجوزات جديدة', values: s.bookings }, { label: 'حصص مكتملة', values: s.completed }]} /></div>
        <div className="card"><h3>مستخدمون ومتعلّمون جدد</h3><Sparkline labels={s.days} series={[{ label: 'مستخدمون', values: s.newUsers }, { label: 'متعلّمون', values: s.newLearners }]} /></div>
        <div className="card"><h3>الإيراد حسب النوع — هذا الشهر</h3><HBars items={byType} format={money} /><h3 style={{ marginTop: 16 }}>الطلبات حسب وسيلة الدفع</h3><HBars items={Object.entries(br.ordersByProvider).map(([k, v]) => ({ key: k, label: ar(k), value: v }))} /></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card"><h3>حجوزات الشهر حسب الحالة</h3><div className="chips">{Object.entries(br.bookingsByStatus).map(([k, v]) => <Badge key={k} tone={STATUS_TONE[k]}>{ar(k)}: {v}</Badge>)}</div>
          <h3 style={{ marginTop: 14 }}>المحتوى حسب الحالة</h3><div className="chips"><span className="muted small">كتب:</span>{Object.entries(br.contentByStatus.books).map(([k, v]) => <Badge key={k} tone={STATUS_TONE[k]}>{ar(k)}: {v}</Badge>)}{!Object.keys(br.contentByStatus.books).length ? <span className="muted small">—</span> : null}</div>
          <div className="chips" style={{ marginTop: 6 }}><span className="muted small">دورات:</span>{Object.entries(br.contentByStatus.courses).map(([k, v]) => <Badge key={k} tone={STATUS_TONE[k]}>{ar(k)}: {v}</Badge>)}{!Object.keys(br.contentByStatus.courses).length ? <span className="muted small">—</span> : null}</div>
          <h3 style={{ marginTop: 14 }}>المعلّمون حسب الحالة</h3><div className="chips">{Object.entries(d.teachers).map(([k, v]) => <Badge key={k} tone={STATUS_TONE[k]}>{ar(k)}: {v}</Badge>)}{!Object.keys(d.teachers).length ? <span className="muted">لا معلّمين بعد</span> : null}</div></div>
        <div className="card"><h3>أعلى المعلّمين — هذا الشهر</h3>{d.top.teachers.length ? <table><thead><tr><th>المعلّم</th><th>حصص</th><th>إيراد</th></tr></thead><tbody>{d.top.teachers.map(t => <tr key={t.id}><td><TeacherLink id={t.id} name={t.name} /></td><td className="num">{t.lessons}</td><td className="num">{money(t.revenue)}</td></tr>)}</tbody></table> : <Empty text="لا حصص مكتملة هذا الشهر" />}
          <h3 style={{ marginTop: 14 }}>أكثر المواد طلباً</h3>{d.top.subjects.length ? <HBars items={d.top.subjects.map(x => ({ key: String(x.id), label: x.name, value: x.lessons }))} /> : <Empty text="لا حجوزات هذا الشهر" />}</div>
      </div>
    </Page>
  );
}
