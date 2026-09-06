import { q, nowIso } from '../db/index.ts';

export type ItemType = 'book' | 'course' | 'subscription';
export interface AccessResult { allowed: boolean; reason: 'admin' | 'owner' | 'free' | 'purchase' | 'gift' | 'subscription' | 'none' | 'guest' }

/**
 * الحقيقة الوحيدة لمن يملك ماذا — تُستشار قبل تسليم أي محتوى مدفوع.
 * الحجب هنا في الخادم، لا في الواجهة.
 */
export function checkAccess(userId: number | undefined, itemType: 'book' | 'course', itemId: number, roles: string[] = []): AccessResult {
  if (!userId) return { allowed: false, reason: 'guest' };
  if (roles.includes('admin') || roles.includes('super_admin') || roles.includes('content_reviewer')) return { allowed: true, reason: 'admin' };

  const owner = itemType === 'book'
    ? q.get<{ author_id: number; price: number; status: string }>('SELECT author_id AS author_id, price, status FROM books WHERE id = ?', itemId)
    : q.get<{ author_id: number; price: number; status: string }>('SELECT teacher_id AS author_id, price, status FROM courses WHERE id = ?', itemId);
  if (!owner) return { allowed: false, reason: 'none' };
  if (owner.author_id === userId) return { allowed: true, reason: 'owner' };
  if (owner.status === 'published' && Number(owner.price) === 0) return { allowed: true, reason: 'free' };

  const ent = q.get<{ source: AccessResult['reason'] }>(
    `SELECT source FROM entitlements WHERE user_id = ? AND item_type = ? AND item_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
    userId, itemType, itemId, nowIso());
  if (ent) return { allowed: true, reason: ent.source };
  return { allowed: false, reason: 'none' };
}

export function grantAccess(userId: number, itemType: ItemType, itemId: number,
  { source = 'purchase', orderId = null, expiresAt = null }: { source?: string; orderId?: number | null; expiresAt?: string | null } = {}): void {
  q.run(
    `INSERT INTO entitlements (user_id, item_type, item_id, source, order_id, expires_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET source = excluded.source,
       order_id = COALESCE(excluded.order_id, entitlements.order_id), expires_at = excluded.expires_at`,
    userId, itemType, itemId, source, orderId, expiresAt);

  if (itemType === 'course') {
    q.run('INSERT INTO course_enrollments (user_id, course_id, order_id) VALUES (?,?,?) ON CONFLICT(user_id, course_id) DO NOTHING', userId, itemId, orderId);
    q.run('UPDATE courses SET sales_count = (SELECT COUNT(*) FROM course_enrollments WHERE course_id = ?) WHERE id = ?', itemId, itemId);
  }
  if (itemType === 'book') {
    q.run('UPDATE books SET sales_count = (SELECT COUNT(*) FROM entitlements WHERE item_type = ? AND item_id = ? AND source = ?) WHERE id = ?', 'book', itemId, 'purchase', itemId);
  }
}

export function revokeAccess(userId: number, itemType: ItemType, itemId: number): void {
  q.run('DELETE FROM entitlements WHERE user_id = ? AND item_type = ? AND item_id = ?', userId, itemType, itemId);
  if (itemType === 'course') {
    q.run('DELETE FROM course_enrollments WHERE user_id = ? AND course_id = ?', userId, itemId);
    q.run('UPDATE courses SET sales_count = (SELECT COUNT(*) FROM course_enrollments WHERE course_id = ?) WHERE id = ?', itemId, itemId);
  }
  if (itemType === 'book') {
    q.run('UPDATE books SET sales_count = (SELECT COUNT(*) FROM entitlements WHERE item_type = ? AND item_id = ? AND source = ?) WHERE id = ?', 'book', itemId, 'purchase', itemId);
  }
}

export const ownedIds = (userId: number | undefined, itemType: 'book' | 'course'): Set<number> =>
  new Set(userId ? q.all<{ item_id: number }>(
    'SELECT item_id FROM entitlements WHERE user_id = ? AND item_type = ? AND (expires_at IS NULL OR expires_at > ?)', userId, itemType, nowIso())
    .map(r => r.item_id) : []);

export const favoriteIds = (userId: number | undefined, targetType: 'book' | 'course' | 'teacher'): Set<number> =>
  new Set(userId ? q.all<{ target_id: number }>('SELECT target_id FROM favorites WHERE user_id = ? AND target_type = ?', userId, targetType).map(r => r.target_id) : []);
