import { db, q } from '../db/database.js';
import { money } from '../utils/helpers.js';
import { AppError } from '../middleware/error.js';

/** يقيّد حركة على محفظة المستخدم ويعيد الرصيد الجديد. */
export function record(userId, { type, amount, refType = null, refId = null, note = null }) {
  const delta = money(amount);
  const user = q.get('SELECT wallet_balance FROM users WHERE id = ?', userId);
  if (!user) throw new AppError('المستخدم غير موجود', 404, 'not_found');

  const balanceAfter = money(user.wallet_balance + delta);
  if (balanceAfter < 0) throw new AppError('الرصيد غير كافٍ', 400, 'insufficient_funds');

  q.run('UPDATE users SET wallet_balance = ? WHERE id = ?', balanceAfter, userId);
  q.run(
    'INSERT INTO transactions (user_id, type, amount, balance_after, ref_type, ref_id, note) VALUES (?,?,?,?,?,?,?)',
    userId, type, delta, balanceAfter, refType, refId, note,
  );
  return balanceAfter;
}

export const credit = (userId, amount, meta = {}) => record(userId, { ...meta, type: meta.type || 'topup', amount: Math.abs(money(amount)) });
export const debit = (userId, amount, meta = {}) => record(userId, { ...meta, type: meta.type || 'purchase', amount: -Math.abs(money(amount)) });

export const balance = (userId) => money(q.val('SELECT wallet_balance FROM users WHERE id = ?', userId) || 0);

export const history = (userId, limit = 50) =>
  q.all('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit);

/** يضيف أرباح المعلّم بعد خصم العمولة. */
export function creditInstructor(instructorId, amount, { refType, refId, note }) {
  const value = money(amount);
  if (value <= 0) return;
  const exists = q.get('SELECT user_id FROM instructor_profiles WHERE user_id = ?', instructorId);
  if (!exists) q.run('INSERT INTO instructor_profiles (user_id, approved) VALUES (?, 1)', instructorId);

  q.run(
    'UPDATE instructor_profiles SET balance = balance + ?, lifetime_earnings = lifetime_earnings + ? WHERE user_id = ?',
    value, value, instructorId,
  );
  const bal = q.val('SELECT balance FROM instructor_profiles WHERE user_id = ?', instructorId);
  q.run(
    'INSERT INTO transactions (user_id, type, amount, balance_after, ref_type, ref_id, note) VALUES (?,?,?,?,?,?,?)',
    instructorId, 'earning', value, money(bal), refType, refId, note,
  );
}

export const transaction = (fn) => db.transaction(fn)();
