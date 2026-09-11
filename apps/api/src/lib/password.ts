import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * تجزئة كلمات المرور بـ scrypt المدمجة في Node — بلا اعتماد جديد ولا بناء ثنائي أصلي في صورة Docker (خلافاً لـ bcrypt).
 * كل تجزئة تحمل ملحها الخاص: "salt_hex:hash_hex".
 */
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}
