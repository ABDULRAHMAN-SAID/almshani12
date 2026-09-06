import type { Request } from 'express';
import { q } from '../db/index.ts';

/**
 * سجلّ العمليات الحسّاسة — من فعل ماذا ومتى. يُقرأ من لوحة الإدارة فقط.
 * targetUserId: المستخدم المتأثّر بالإجراء (لصفحة الشخص) — يختلف عن entity_id حين يكون الكيان طلباً أو حجزاً أو تقييماً.
 */
export function audit(req: Request | null, action: string, entity?: string | null, entityId?: number | null, meta?: unknown, targetUserId?: number | null) {
  q.run('INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta, ip, target_user_id) VALUES (?,?,?,?,?,?,?)',
    req?.user?.id ?? null, action, entity ?? null, entityId ?? null, meta == null ? null : JSON.stringify(meta), req?.ip ?? null, targetUserId ?? null);
}
