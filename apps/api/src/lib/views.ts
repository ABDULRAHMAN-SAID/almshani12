import { q, json } from '../db/index.ts';
import { money } from './helpers.ts';
import { publicUrlFromPath } from '../services/mappers.ts';

/** المستخدم كما يراه هو نفسه — الهاتف والبريد لا يظهران لغيره أبداً */
export function userView(userId: number) {
  const u = q.get<any>('SELECT * FROM users WHERE id = ?', userId);
  if (!u) return null;
  const p = q.get<any>('SELECT * FROM profiles WHERE user_id = ?', userId);
  const roles = q.all<{ role: string }>('SELECT role FROM user_roles WHERE user_id = ?', userId).map(r => r.role);
  const sp = q.get<any>('SELECT sp.*, g.name AS grade_name, s.name AS semester_name FROM student_profiles sp LEFT JOIN grades g ON g.id = sp.grade_id LEFT JOIN semesters s ON s.id = sp.semester_id WHERE sp.user_id = ?', userId);
  const tp = q.get<any>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', userId);
  return {
    id: u.id, phone: u.phone, email: u.email,
    displayName: p?.display_name ?? '', avatarUrl: publicUrlFromPath(p?.avatar_path),
    roles, locale: u.locale, timezone: u.timezone, onboardingCompleted: !!u.onboarding_completed,
    student: sp ? {
      curriculumId: sp.curriculum_id, gradeId: sp.grade_id, gradeName: sp.grade_name ?? null,
      semesterId: sp.semester_id, semesterName: sp.semester_name ?? null,
      subjectIds: q.all<{ subject_id: number }>('SELECT subject_id FROM student_subjects WHERE user_id = ?', userId).map(r => r.subject_id),
    } : null,
    teacher: tp ? { verificationStatus: tp.verification_status } : null,
    createdAt: u.created_at,
  };
}

export function orderView(o: any) {
  const items = q.all<any>('SELECT item_type, item_id, title, unit_price, quantity FROM order_items WHERE order_id = ?', o.id)
    .map(i => ({ itemType: i.item_type, itemId: i.item_id, title: i.title, unitPrice: money(i.unit_price), quantity: i.quantity }));
  return {
    id: o.id, number: o.number, status: o.status,
    subtotal: money(o.subtotal), discount: money(o.discount), tax: money(o.tax), total: money(o.total), currency: o.currency,
    provider: o.provider ?? null, items, createdAt: o.created_at, paidAt: o.paid_at ?? null, invoiceUrl: null,
  };
}

export const notificationView = (n: any) => ({
  id: n.id, type: n.type, title: n.title, body: n.body ?? null, data: json<Record<string, unknown> | null>(n.data, null), readAt: n.read_at ?? null, createdAt: n.created_at,
});
