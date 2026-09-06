import { q } from '../db/database.js';

let io = null;
export const bindIo = (server) => { io = server; };

/** ينشئ إشعاراً ويبثّه فوراً عبر Socket.IO إن كان المستخدم متصلاً. */
export function notify(userId, { type = 'info', title, body = null, link = null }) {
  if (!userId || !title) return null;
  const info = q.run(
    'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)',
    userId, type, title, body, link,
  );
  const row = q.get('SELECT * FROM notifications WHERE id = ?', info.lastInsertRowid);
  io?.to(`user:${userId}`).emit('notification', row);
  return row;
}

/** إشعار جماعي (لكل طلاب دورة مثلاً). */
export function notifyMany(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const id of unique) notify(id, payload);
  return unique.length;
}

export function notifyCourseStudents(courseId, payload) {
  const rows = q.all('SELECT user_id FROM enrollments WHERE course_id = ?', courseId);
  return notifyMany(rows.map(r => r.user_id), payload);
}

export function notifyAdmins(payload) {
  const rows = q.all("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  return notifyMany(rows.map(r => r.id), payload);
}
