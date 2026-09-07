import { q, settings, nowIso } from '../db/index.ts';
import { money, addHours } from '../lib/helpers.ts';

type Source = 'lesson' | 'book' | 'course' | 'package';

/**
 * أرباح المعلّم — الحساب في الخادم فقط.
 * تُقيَّد pending عند الدفع، وتصبح available بعد نافذة الاحتجاز
 * (أو بعد اكتمال الحصة للدروس)، وتُصرف بطلب سحب تعتمده الإدارة.
 */
export function recordEarning(teacherId: number, { sourceType, sourceId, orderId, gross, commissionRate }:
  { sourceType: Source; sourceId: number; orderId: number | null; gross: number; commissionRate?: number }): number {
  const rate = commissionRate ?? q.val<number>('SELECT commission_rate FROM teacher_profiles WHERE user_id = ?', teacherId) ?? settings.get<number>('commission_rate');
  const commission = money(gross * rate);
  const net = money(gross - commission);
  const holdHours = settings.get<number>('earnings_hold_hours');
  // الحصص تتحرّر عند اكتمالها لا بالوقت — والباقة مثلها: حصة حصة عند تسليمها؛ الكتب والدورات بعد نافذة الاسترجاع
  const availableAt = sourceType === 'lesson' || sourceType === 'package' ? null : addHours(holdHours);
  const info = q.run(
    `INSERT INTO teacher_earnings (teacher_id, source_type, source_id, order_id, gross, commission, net, status, available_at)
     VALUES (?,?,?,?,?,?,?,'pending',?)`,
    teacherId, sourceType, sourceId, orderId, money(gross), commission, net, availableAt);
  q.run('UPDATE teacher_profiles SET pending_balance = pending_balance + ?, lifetime_earnings = lifetime_earnings + ? WHERE user_id = ?', net, net, teacherId);
  return Number(info.lastInsertRowid);
}

/** يحرّر الأرباح المستحقّة (مهمة دورية) أو حصة بعينها عند اكتمالها */
export function releaseEarnings(filter: { sourceType?: Source; sourceId?: number } = {}): number {
  const where = ['status = ?', "(available_at IS NULL OR available_at <= ?)"];
  const params: unknown[] = ['pending', nowIso()];
  if (filter.sourceType) { where.push('source_type = ?'); params.push(filter.sourceType); }
  if (filter.sourceId) { where.push('source_id = ?'); params.push(filter.sourceId); }
  else where.push("source_type NOT IN ('lesson','package')"); // الحصص (ومنها حصص الباقة) تتحرّر بالتسليم لا بالوقت
  const rows = q.all<{ id: number; teacher_id: number; net: number }>(`SELECT id, teacher_id, net FROM teacher_earnings WHERE ${where.join(' AND ')}`, ...params);
  for (const r of rows) {
    q.run("UPDATE teacher_earnings SET status = 'available' WHERE id = ?", r.id);
    q.run('UPDATE teacher_profiles SET pending_balance = pending_balance - ?, available_balance = available_balance + ? WHERE user_id = ?', r.net, r.net, r.teacher_id);
  }
  return rows.length;
}

/** عكس ربح عند الاسترجاع — لا يُدخل رصيد المعلّم في السالب إن كان قد سُحب */
export function reverseEarning(filter: { orderId?: number; sourceType?: Source; sourceId?: number }): void {
  const where: string[] = ["status IN ('pending','available')"];
  const params: unknown[] = [];
  if (filter.orderId) { where.push('order_id = ?'); params.push(filter.orderId); }
  if (filter.sourceType) { where.push('source_type = ?'); params.push(filter.sourceType); }
  if (filter.sourceId) { where.push('source_id = ?'); params.push(filter.sourceId); }
  const rows = q.all<{ id: number; teacher_id: number; net: number; status: string }>(`SELECT id, teacher_id, net, status FROM teacher_earnings WHERE ${where.join(' AND ')}`, ...params);
  for (const r of rows) {
    q.run("UPDATE teacher_earnings SET status = 'reversed' WHERE id = ?", r.id);
    const col = r.status === 'available' ? 'available_balance' : 'pending_balance';
    q.run(`UPDATE teacher_profiles SET ${col} = MAX(0, ${col} - ?), lifetime_earnings = MAX(0, lifetime_earnings - ?) WHERE user_id = ?`, r.net, r.net, r.teacher_id);
  }
}

export function summary(teacherId: number) {
  const agg = (status: string) => money(q.val<number>('SELECT COALESCE(SUM(net),0) FROM teacher_earnings WHERE teacher_id = ? AND status = ?', teacherId, status) ?? 0);
  const bySource = (src: Source) => money(q.val<number>("SELECT COALESCE(SUM(net),0) FROM teacher_earnings WHERE teacher_id = ? AND source_type = ? AND status <> 'reversed'", teacherId, src) ?? 0);
  const totals = q.get<{ gross: number; commission: number; net: number }>(
    "SELECT COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(commission),0) AS commission, COALESCE(SUM(net),0) AS net FROM teacher_earnings WHERE teacher_id = ? AND status <> 'reversed'", teacherId)!;
  // «متاح للسحب» هو رصيد الملف نفسه الذي يخصم منه طلب السحب ويتحقّق منه الخادم —
  // مجموع الأرباح المتاحة وحده يتجاهل ما طُلب سحبه فيدعو المعلّم لطلب مبلغ سيُرفض.
  const balance = q.get<{ available_balance: number }>('SELECT available_balance FROM teacher_profiles WHERE user_id = ?', teacherId);
  const payouts = (status: string[]) => money(q.val<number>(
    `SELECT COALESCE(SUM(amount),0) FROM teacher_payouts WHERE teacher_id = ? AND status IN (${status.map(() => '?').join(',')})`, teacherId, ...status) ?? 0);
  return {
    gross: money(totals.gross), commission: money(totals.commission), net: money(totals.net),
    pending: agg('pending'), available: money(balance?.available_balance ?? 0), paid: payouts(['paid']),
    /** طلبات سحب لم تُصرف بعد — خرجت من «متاح للسحب» ولم تدخل «مصروف» */
    requested: payouts(['pending', 'approved']),
    breakdown: { lessons: money(bySource('lesson') + bySource('package')), books: bySource('book'), courses: bySource('course') },
  };
}
