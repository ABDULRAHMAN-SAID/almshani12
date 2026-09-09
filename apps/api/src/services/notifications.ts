import type { Server } from 'socket.io';
import { q } from '../db/index.ts';
import { sendPush } from './push.ts';

let io: Server | null = null;
export const bindIo = (server: Server) => { io = server; };

export interface NotifyInput { type: string; title: string; body?: string | null; data?: Record<string, unknown> | null }

/** يُنشئ إشعاراً ويبثّه فوراً لمن هو متصل، ثم يدفعه لأجهزة المستخدم (متصفح/Expo) دون انتظار */
export function notify(userId: number, { type, title, body = null, data = null }: NotifyInput) {
  if (!userId) return null;
  // عنوان فارغ (اسم مرسِل لم يُضبط بعد) كان يُسقط الإشعار والبثّ والدفع معاً فلا يصل المستخدم شيء:
  // نضع عنواناً عاماً بدل إسقاط الإشعار.
  const heading = title?.trim() || 'إشعار جديد';
  const info = q.run('INSERT INTO notifications (user_id, type, title, body, data) VALUES (?,?,?,?,?)',
    userId, type, heading, body, data ? JSON.stringify(data) : null);
  const row = q.get<any>('SELECT * FROM notifications WHERE id = ?', info.lastInsertRowid);
  io?.to(`user:${userId}`).emit('notification', { ...row, data });
  void sendPush(userId, { title: heading, body, data: { ...(data ?? {}), type, notificationId: row.id } });
  return row;
}

export const notifyMany = (userIds: number[], input: NotifyInput) => { for (const id of new Set(userIds)) notify(id, input); };

export const notifyStaff = (roles: string[], input: NotifyInput) => {
  const ids = q.all<{ user_id: number }>(
    `SELECT DISTINCT user_id FROM user_roles WHERE role IN (${roles.map(() => '?').join(',')})`, ...roles).map(r => r.user_id);
  notifyMany(ids, input);
};

export const unreadCount = (userId: number): number =>
  q.val<number>('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', userId) ?? 0;
