import type { Server } from 'socket.io';
import { q } from '../db/index.ts';

let io: Server | null = null;
export const bindIo = (server: Server) => { io = server; };

export interface NotifyInput { type: string; title: string; body?: string | null; data?: Record<string, unknown> | null }

/** يُنشئ إشعاراً ويبثّه فوراً لمن هو متصل — والدفع للجوال (push) يُضاف في المرحلة ١ */
export function notify(userId: number, { type, title, body = null, data = null }: NotifyInput) {
  if (!userId || !title) return null;
  const info = q.run('INSERT INTO notifications (user_id, type, title, body, data) VALUES (?,?,?,?,?)',
    userId, type, title, body, data ? JSON.stringify(data) : null);
  const row = q.get<any>('SELECT * FROM notifications WHERE id = ?', info.lastInsertRowid);
  io?.to(`user:${userId}`).emit('notification', { ...row, data });
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
