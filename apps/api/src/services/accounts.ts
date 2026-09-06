import type { Role } from '@manassah/shared';
import { db, q, nowIso } from '../db/index.ts';
import { AppError } from '../lib/errors.ts';
import type { SocialIdentity } from '../lib/social.ts';

/**
 * إنشاء الحسابات وربط الهويات: المسار الوحيد الذي يُنشئ مستخدماً من الدخول (رمز تحقّق أو Google/Apple).
 * الحساب الجديد = صف users + ملف شخصي + دور واحد + هوية في auth_identities؛ المتعلّم يُنشأ لاحقاً في الإعداد الأوّلي كما في OTP.
 */
export type SignupRole = Extract<Role, 'student' | 'teacher' | 'parent'>;
export interface AccountRef { id: number; isNew: boolean }

const suspended = () => new AppError('forbidden', 'هذا الحساب موقوف', 403);
const assertActive = (u: { id: number; status: string }): AccountRef => { if (u.status !== 'active') throw suspended(); return { id: u.id, isNew: false }; };

function createAccount(input: { phone?: string | null; email?: string | null; displayName?: string; role?: SignupRole; locale?: 'ar' | 'en'; provider: string; providerUid: string }): AccountRef {
  return db.transaction(() => {
    const info = q.run('INSERT INTO users (phone, email, locale) VALUES (?,?,?)', input.phone ?? null, input.email ?? null, input.locale ?? 'ar');
    const id = Number(info.lastInsertRowid);
    q.run('INSERT INTO profiles (user_id, display_name) VALUES (?, ?)', id, (input.displayName ?? '').slice(0, 60));
    q.run('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', id, input.role ?? 'student');
    q.run('INSERT INTO auth_identities (user_id, provider, provider_uid) VALUES (?,?,?)', id, input.provider, input.providerUid);
    return { id, isNew: true };
  })();
}

/** الدخول برمز تحقّق: الهدف (هاتف/بريد) هو الهوية — حساب جديد بدور طالب عند أول دخول */
export function findOrCreateUser(channel: 'phone' | 'email', target: string): AccountRef {
  const col = channel === 'phone' ? 'phone' : 'email';
  const existing = q.get<{ id: number; status: string }>(`SELECT id, status FROM users WHERE ${col} = ?`, target);
  if (existing) return assertActive(existing);
  return createAccount({ [col]: target, provider: channel === 'phone' ? 'phone_otp' : 'email_otp', providerUid: target });
}

/**
 * الدخول الاجتماعي: الهوية (provider, sub) → الحساب؛ وإلا بريد موثّق مطابق → يُربط بالحساب نفسه؛ وإلا حساب جديد.
 * الحساب الجديد يحتاج بريداً موثّقاً (users تشترط هاتفاً أو بريداً) — والمزوّدان يرسلانه دائماً عند طلب scope البريد.
 * دور «معلّم» لا يُمنح ذاتياً هنا (يحتاج ملفّ معلّم بحالة مراجعة عبر /teachers) — يُستبدل بطالب كما في مسار الرمز.
 */
export function findOrLinkSocialUser(identity: SocialIdentity, opts: { role?: SignupRole; locale?: 'ar' | 'en'; displayName?: string | null } = {}): AccountRef {
  const linked = q.get<{ id: number; status: string }>(
    'SELECT u.id, u.status FROM auth_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.provider = ? AND ai.provider_uid = ?', identity.provider, identity.sub);
  if (linked) return assertActive(linked);
  const email = identity.emailVerified ? identity.email : null;
  const displayName = (opts.displayName ?? identity.name ?? '').trim();
  if (email) {
    const byEmail = q.get<{ id: number; status: string }>('SELECT id, status FROM users WHERE email = ?', email);
    if (byEmail) {
      const ref = assertActive(byEmail);
      db.transaction(() => {
        q.run('INSERT OR IGNORE INTO auth_identities (user_id, provider, provider_uid) VALUES (?,?,?)', ref.id, identity.provider, identity.sub);
        // اسم فارغ من حساب قديم يُستكمل من المزوّد فقط — لا نستبدل اسماً اختاره المستخدم
        if (displayName) q.run("UPDATE profiles SET display_name = ?, updated_at = ? WHERE user_id = ? AND display_name = ''", displayName.slice(0, 60), nowIso(), ref.id);
      })();
      return ref;
    }
  }
  if (!email) throw new AppError('validation_error', 'حساب المزوّد لا يحمل بريداً موثّقاً — استخدم رمز التحقّق بالهاتف أو البريد', 400);
  return createAccount({ email, displayName, role: opts.role === 'teacher' ? 'student' : opts.role, locale: opts.locale, provider: identity.provider, providerUid: identity.sub });
}
