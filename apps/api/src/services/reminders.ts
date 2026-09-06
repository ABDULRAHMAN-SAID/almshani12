import { q, settings, nowIso } from '../db/index.ts';
import { notify } from './notifications.ts';
import { learnerRefById } from './learners.ts';

/** تذكيرات الحصص (قبل ٦٠ و١٥ دقيقة افتراضياً — من الإعدادات) بلا تكرار */
export function sendLessonReminders(): number {
  const minutes = settings.get<number[]>('reminder_minutes');
  let sent = 0;
  for (const m of minutes) {
    const type = m >= 60 ? 'lesson_in_1h' : 'lesson_in_15m';
    const from = nowIso();
    const to = new Date(Date.now() + m * 60_000).toISOString();
    const rows = q.all<any>(`SELECT b.id, b.student_id, b.teacher_id, b.learner_id, b.starts_at, s.name AS subject FROM bookings b JOIN subjects s ON s.id = b.subject_id
      WHERE b.status = 'confirmed' AND b.starts_at > ? AND b.starts_at <= ?`, from, to);
    for (const b of rows) {
      // اسم المتعلّم في النص (وليّ الأمر بعدّة أبناء والمعلّم يعرفان لمن الحصة) — المستلمون: الحساب والمعلّم كما هما
      const learner = learnerRefById(b.learner_id);
      const body = learner ? `حصة ${learner.displayName} — جهّز الكاميرا والمايك` : 'جهّز الكاميرا والمايك';
      for (const uid of [b.student_id, b.teacher_id]) {
        const dup = q.get('SELECT 1 FROM notifications WHERE user_id = ? AND type = ? AND data LIKE ?', uid, type, `%"bookingId":${b.id}%`);
        if (dup) continue;
        notify(uid, { type, title: m >= 60 ? `حصة ${b.subject} بعد ساعة` : `حصة ${b.subject} بعد ${m} دقيقة`, body, data: { bookingId: b.id } });
        sent++;
      }
    }
  }
  return sent;
}
