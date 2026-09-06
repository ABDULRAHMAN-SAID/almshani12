import { q } from '../db/index.ts';
import { money } from '../lib/helpers.ts';
import { AppError } from '../lib/errors.ts';

type TxType = 'topup' | 'purchase' | 'refund' | 'adjustment' | 'bonus';

/** دفتر المحفظة: كل حركة تُقيَّد مع الرصيد اللاحق — لا تعديل مباشر للرصيد */
export function record(userId: number, { type, amount, refType = null, refId = null, note = null }:
  { type: TxType; amount: number; refType?: string | null; refId?: number | null; note?: string | null }): number {
  q.run('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, 0)', userId);
  const current = q.val<number>('SELECT balance FROM wallets WHERE user_id = ?', userId) ?? 0;
  const delta = money(amount);
  const after = money(current + delta);
  if (after < 0) throw new AppError('insufficient_funds', 'الرصيد غير كافٍ', 400);
  q.run('UPDATE wallets SET balance = ? WHERE user_id = ?', after, userId);
  q.run('INSERT INTO wallet_transactions (user_id, type, amount, balance_after, ref_type, ref_id, note) VALUES (?,?,?,?,?,?,?)',
    userId, type, delta, after, refType, refId, note);
  return after;
}

export const credit = (userId: number, amount: number, meta: { type?: TxType; refType?: string; refId?: number; note?: string } = {}) =>
  record(userId, { ...meta, type: meta.type ?? 'topup', amount: Math.abs(money(amount)) });
export const debit = (userId: number, amount: number, meta: { type?: TxType; refType?: string; refId?: number; note?: string } = {}) =>
  record(userId, { ...meta, type: meta.type ?? 'purchase', amount: -Math.abs(money(amount)) });

export const balance = (userId: number): number => money(q.val<number>('SELECT balance FROM wallets WHERE user_id = ?', userId) ?? 0);
export const history = (userId: number, limit = 60) =>
  q.all('SELECT id, type, amount, balance_after, note, created_at FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit);
