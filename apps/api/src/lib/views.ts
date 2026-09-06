import { q, json } from '../db/index.ts';
import { money } from './helpers.ts';
import { publicUrlFromPath } from '../services/mappers.ts';
import { listLearners, resolveLearnerForAccount, learnerRefById } from '../services/learners.ts';

/** المستخدم كما يراه هو نفسه — الهاتف والبريد لا يظهران لغيره أبداً */
export function userView(userId: number) {
  const u = q.get<any>('SELECT * FROM users WHERE id = ?', userId);
  if (!u) return null;
  const p = q.get<any>('SELECT * FROM profiles WHERE user_id = ?', userId);
  const roles = q.all<{ role: string }>('SELECT role FROM user_roles WHERE user_id = ?', userId).map(r => r.role);
  const learners = listLearners(userId);
  // student (مهمل): مرآة للمتعلّم النشط أو الافتراضي — للتطبيقات القديمة، يُحذف في الإصدار التالي
  const active = resolveLearnerForAccount(userId, null, null);
  const tp = q.get<any>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', userId);
  return {
    id: u.id, phone: u.phone, email: u.email,
    displayName: p?.display_name ?? '', avatarUrl: publicUrlFromPath(p?.avatar_path),
    roles, locale: u.locale, timezone: u.timezone, onboardingCompleted: !!u.onboarding_completed,
    student: active ? {
      curriculumId: active.curriculum_id, gradeId: active.grade_id, gradeName: active.grade_name ?? null,
      semesterId: active.semester_id, semesterName: active.semester_name ?? null,
      subjectIds: learners.find(l => l.id === active.id)?.subjectIds ?? [],
    } : null,
    learners, activeLearnerId: u.active_learner_id ?? null,
    teacher: tp ? { verificationStatus: tp.verification_status } : null,
    createdAt: u.created_at,
  };
}

/** الطلب كما يراه صاحبه والإدارة — يحمل learner: LearnerRef|null دائماً */
export function orderView(o: any) {
  const items = q.all<any>('SELECT item_type, item_id, title, unit_price, quantity FROM order_items WHERE order_id = ?', o.id)
    .map(i => ({ itemType: i.item_type, itemId: i.item_id, title: i.title, unitPrice: money(i.unit_price), quantity: i.quantity }));
  return {
    id: o.id, number: o.number, status: o.status,
    subtotal: money(o.subtotal), discount: money(o.discount), tax: money(o.tax), total: money(o.total), currency: o.currency,
    provider: o.provider ?? null, items, createdAt: o.created_at, paidAt: o.paid_at ?? null, invoiceUrl: null,
    learner: learnerRefById(o.learner_id), // المتعلّم المنسوب إليه الطلب (D3) — يصل كل من يعرض طلباً، بما فيه مسارات الإدارة
  };
}

export const notificationView = (n: any) => ({
  id: n.id, type: n.type, title: n.title, body: n.body ?? null, data: json<Record<string, unknown> | null>(n.data, null), readAt: n.read_at ?? null, createdAt: n.created_at,
});
