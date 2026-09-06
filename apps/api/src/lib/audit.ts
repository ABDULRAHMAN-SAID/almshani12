import type { Request } from 'express';
import { q } from '../db/index.ts';

/** سجلّ العمليات الحسّاسة — من فعل ماذا ومتى. يُقرأ من لوحة الإدارة فقط. */
export function audit(req: Request | null, action: string, entity?: string | null, entityId?: number | null, meta?: unknown) {
  q.run('INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta, ip) VALUES (?,?,?,?,?,?)',
    req?.user?.id ?? null, action, entity ?? null, entityId ?? null, meta == null ? null : JSON.stringify(meta), req?.ip ?? null);
}
