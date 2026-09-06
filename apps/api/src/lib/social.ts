import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { config } from '../config.ts';
import { AppError, unauthorized } from './errors.ts';

/**
 * الدخول الاجتماعي: تحقّق من رموز Google (ID token) وApple (identity token) بمفاتيح المزوّد العامة (JWKS) عبر jose.
 * الجمهور المقبول = معرّفات العملاء المضبوطة في config.auth — بلا معرّفات يُرفض الطلب بـ 501 (المزوّد غير مفعّل).
 * `jwksResolvers` قابل للاستبدال كي تحقن الاختبارات مجموعة مفاتيح محلية (createLocalJWKSet) بدل الشبكة.
 */
export type SocialProvider = 'google' | 'apple';
export interface SocialIdentity {
  provider: SocialProvider;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_JWKS = 'https://appleid.apple.com/auth/keys';
const INVALID = 'رمز الدخول غير صالح';

/** مجموعة مفاتيح بعيدة تُنشأ مرة واحدة لكل عملية (jose يخزّنها مؤقتاً ويجدّدها عند مفتاح مجهول) */
const remote = (url: string) => { let set: JWTVerifyGetKey | null = null; return () => (set ??= createRemoteJWKSet(new URL(url))); };
export const jwksResolvers: Record<SocialProvider, () => JWTVerifyGetKey> = { google: remote(GOOGLE_JWKS), apple: remote(APPLE_JWKS) };

/** الجمهور المقبول: Google معرّفات العملاء؛ Apple معرّفات التطبيق + Services ID للويب (رمز Apple JS يحمل aud = Services ID) */
export const audienceFor = (provider: SocialProvider): string[] =>
  provider === 'apple' ? [...new Set([...config.auth.apple.clientIds, config.auth.apple.servicesId].filter(Boolean))] : config.auth.google.clientIds;
export const socialConfigured = (provider: SocialProvider): boolean => audienceFor(provider).length > 0;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
/** المزوّدان يرسلان email_verified أحياناً كنصّ "true" */
const verified = (v: unknown): boolean => v === true || v === 'true';

async function verify(provider: SocialProvider, token: string, issuer: string | string[]): Promise<JWTPayload> {
  if (!socialConfigured(provider)) throw new AppError('content_unavailable', provider === 'google'
    ? 'تسجيل الدخول بحساب Google يتطلّب ضبط GOOGLE_CLIENT_ID'
    : 'تسجيل الدخول بحساب Apple يتطلّب ضبط مفاتيح المطوّر (APPLE_CLIENT_ID)', 501);
  if (!token || token.length > 8192) throw unauthorized(INVALID);
  try {
    const { payload } = await jwtVerify(token, jwksResolvers[provider](), { issuer, audience: audienceFor(provider), clockTolerance: 60 });
    if (!str(payload.sub)) throw unauthorized(INVALID);
    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    // لا نسرّب تفاصيل الرمز؛ يكفي السبب للسجلّ
    console.warn(`[social] ${provider} token rejected: ${(err as Error)?.name ?? 'error'}`);
    throw unauthorized(INVALID);
  }
}

export async function verifyGoogle(idToken: string): Promise<SocialIdentity> {
  const p = await verify('google', idToken, ['https://accounts.google.com', 'accounts.google.com']);
  const email = str(p.email)?.toLowerCase() ?? null;
  return { provider: 'google', sub: String(p.sub), email, emailVerified: !!email && verified(p.email_verified), name: str(p.name), picture: str(p.picture) };
}

export async function verifyApple(identityToken: string): Promise<SocialIdentity> {
  const p = await verify('apple', identityToken, 'https://appleid.apple.com');
  const email = str(p.email)?.toLowerCase() ?? null;
  return { provider: 'apple', sub: String(p.sub), email, emailVerified: !!email && verified(p.email_verified), name: null, picture: null };
}
