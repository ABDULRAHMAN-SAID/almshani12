import { Router } from 'express';
import { z } from 'zod';
import { SendMessage } from '@manassah/shared';
import { db, q, nowIso } from '../db/index.ts';
import { AppError, notFound, forbidden, badRequest } from '../lib/errors.ts';
import { validate, body, idParam } from '../lib/validate.ts';
import { requireAuth } from '../lib/auth.ts';
import { iso } from '../lib/helpers.ts';
import { signedUrl } from '../services/storage.ts';
import { publicUrlFromPath } from '../services/mappers.ts';
import { notify } from '../services/notifications.ts';

/**
 * الرسائل: بين طالب ومعلّم فقط. الطالب يبدأ مع أي معلّم معتمد؛
 * المعلّم لا يبدأ إلا مع طالب لديه حجز معه (حماية القاصرين). الحظر يقطع الطرفين.
 */
const router = Router();
router.use(requireAuth);

const blocked = (a: number, b: number) => !!q.get('SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)', a, b, b, a);

const convView = (c: any, viewerId: number) => {
  const otherId = c.student_id === viewerId ? c.teacher_id : c.student_id;
  const other = q.get<any>('SELECT display_name, avatar_path FROM profiles WHERE user_id = ?', otherId);
  const last = q.get<any>('SELECT body, kind FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', c.id);
  const unread = q.val<number>('SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL', c.id, viewerId) ?? 0;
  let context: any = null;
  if (c.context_type && c.context_id) {
    const title = c.context_type === 'booking' ? q.val<string>('SELECT s.name FROM bookings b JOIN subjects s ON s.id = b.subject_id WHERE b.id = ?', c.context_id)
      : c.context_type === 'book' ? q.val<string>('SELECT title FROM books WHERE id = ?', c.context_id) : q.val<string>('SELECT title FROM courses WHERE id = ?', c.context_id);
    context = { type: c.context_type, id: c.context_id, title: title ?? '' };
  }
  return {
    id: c.id, other: { id: otherId, name: other?.display_name ?? '', avatarUrl: publicUrlFromPath(other?.avatar_path), role: c.student_id === viewerId ? 'teacher' : 'student' },
    lastMessage: last ? (last.kind === 'text' ? last.body : last.kind === 'image' ? '📎 صورة' : '📎 ملف') : null, lastAt: iso(c.last_message_at), unread, context,
  };
};
const msgView = (m: any, viewerId: number) => ({
  id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, kind: m.kind, body: m.body,
  fileUrl: m.file_id ? signedUrl(m.file_id, viewerId).url : null, replyToId: m.reply_to_id, createdAt: iso(m.created_at),
});

router.get('/', (req, res) => {
  const uid = req.user!.id;
  const rows = q.all<any>('SELECT * FROM conversations WHERE student_id = ? OR teacher_id = ? ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 100', uid, uid);
  res.json(rows.map(c => convView(c, uid)));
});

const StartBody = z.object({ userId: z.number().int().positive(), context: z.object({ type: z.enum(['booking', 'book', 'course']), id: z.number().int().positive() }).nullable().optional() });
router.post('/', validate(StartBody), (req, res) => {
  const { userId: otherId, context } = body<typeof StartBody>(req);
  const uid = req.user!.id;
  if (otherId === uid) throw badRequest();
  if (blocked(uid, otherId)) throw forbidden('لا يمكن بدء محادثة مع هذا المستخدم');
  const iAmTeacher = req.user!.roles.includes('teacher') && !!q.get("SELECT 1 FROM teacher_profiles WHERE user_id = ? AND verification_status = 'verified'", uid);
  const otherIsTeacher = !!q.get("SELECT 1 FROM teacher_profiles WHERE user_id = ? AND verification_status = 'verified'", otherId);
  let studentId: number, teacherId: number;
  if (otherIsTeacher && !iAmTeacher) { studentId = uid; teacherId = otherId; }
  else if (iAmTeacher && !otherIsTeacher) {
    if (!q.get("SELECT 1 FROM bookings WHERE teacher_id = ? AND student_id = ? AND status IN ('confirmed','in_progress','completed')", uid, otherId)) throw forbidden('يمكنك مراسلة الطلاب الذين حجزوا معك فقط');
    studentId = otherId; teacherId = uid;
  } else throw badRequest('المحادثة بين طالب ومعلّم فقط');
  const existing = q.get<any>('SELECT * FROM conversations WHERE student_id = ? AND teacher_id = ?', studentId, teacherId);
  if (existing) return res.json(convView(existing, uid));
  const info = q.run('INSERT INTO conversations (student_id, teacher_id, context_type, context_id) VALUES (?,?,?,?)', studentId, teacherId, context?.type ?? null, context?.id ?? null);
  res.status(201).json(convView(q.get<any>('SELECT * FROM conversations WHERE id = ?', info.lastInsertRowid), uid));
});

const loadConv = (req: any) => {
  const c = q.get<any>('SELECT * FROM conversations WHERE id = ?', idParam(req));
  if (!c) throw notFound();
  if (c.student_id !== req.user!.id && c.teacher_id !== req.user!.id && !req.user!.roles.some((r: string) => ['support', 'admin', 'super_admin'].includes(r))) throw forbidden();
  return c;
};
router.get('/:id/messages', (req, res) => {
  const c = loadConv(req);
  const uid = req.user!.id;
  const before = Number(req.query.before) || null;
  const rows = q.all<any>(`SELECT * FROM messages WHERE conversation_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 50`, ...(before ? [c.id, before] : [c.id])).reverse();
  // التطبيق يستطلع كل بضع ثوانٍ: لا نفتح معاملة كتابة إلا إذا كان هناك غير مقروء فعلاً
  if (rows.some(m => m.sender_id !== uid && !m.read_at)) q.run('UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL', nowIso(), c.id, uid);
  res.json(rows.map(m => msgView(m, uid)));
});
router.post('/:id/messages', validate(SendMessage), (req, res) => {
  const c = loadConv(req);
  const uid = req.user!.id;
  const m = body<typeof SendMessage>(req);
  const otherId = c.student_id === uid ? c.teacher_id : c.student_id;
  if (blocked(uid, otherId)) throw forbidden('المحادثة محظورة');
  if (m.kind === 'text' && !m.body?.trim()) throw badRequest('الرسالة فارغة');
  if (m.kind !== 'text') {
    const f = q.get<any>('SELECT owner_id FROM files WHERE id = ?', m.fileId ?? 0);
    if (!f || f.owner_id !== uid) throw badRequest('الملف غير صالح');
  }
  const row = db.transaction(() => {
    const info = q.run('INSERT INTO messages (conversation_id, sender_id, kind, body, file_id, reply_to_id) VALUES (?,?,?,?,?,?)', c.id, uid, m.kind, m.body ?? null, m.fileId ?? null, m.replyToId ?? null);
    q.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', nowIso(), c.id);
    return q.get<any>('SELECT * FROM messages WHERE id = ?', info.lastInsertRowid);
  })();
  const senderName = q.val<string>('SELECT display_name FROM profiles WHERE user_id = ?', uid) ?? '';
  notify(otherId, { type: 'message', title: senderName, body: m.kind === 'text' ? (m.body ?? '').slice(0, 100) : 'مرفق جديد', data: { conversationId: c.id } });
  res.status(201).json(msgView(row, uid));
});

export { AppError };
export default router;
