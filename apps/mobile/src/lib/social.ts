import { Platform } from 'react-native';

/**
 * الدخول الاجتماعي: على الويب نحمّل مكتبتَي Google Identity Services وApple JS عند الحاجة فقط،
 * وعلى الجوال نحمّل expo-apple-authentication وexpo-auth-session بشكل مؤجّل ومحروس كي لا تدخل مسار الويب.
 * النتيجة دائماً رمز هوية (ID token) يُرسَل إلى POST /auth/google أو /auth/apple.
 */
export interface SocialName { givenName?: string | null; familyName?: string | null }
export interface AppleResult { identityToken: string; fullName?: SocialName | null }

/* ---------- الويب: تحميل السكربتات ---------- */
interface GoogleGsi {
  accounts: { id: {
    initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: 'popup'; itp_support?: boolean; use_fedcm_for_prompt?: boolean }): void;
    renderButton(el: HTMLElement, o: Record<string, string | number>): void;
    prompt(): void;
  } };
}
interface AppleJs {
  auth: {
    init(o: { clientId: string; scope: string; redirectURI: string; usePopup: boolean; state?: string }): void;
    signIn(): Promise<{ authorization: { id_token: string; code?: string }; user?: { name?: { firstName?: string; lastName?: string }; email?: string } }>;
  };
}
declare global { interface Window { google?: GoogleGsi; AppleID?: AppleJs } }

const GSI_SRC = 'https://accounts.google.com/gsi/client';
/** المسار الموثّق عند Apple يستعمل شرطة سفلية في اللغة (en_US) */
const APPLE_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
const pending = new Map<string, Promise<void>>();

function loadScript(src: string, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  let p = pending.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true;
      s.onload = () => (ready() ? resolve() : reject(new Error('script_not_ready')));
      s.onerror = () => { pending.delete(src); reject(new Error('script_load_failed')); };
      document.head.appendChild(s);
    });
    pending.set(src, p);
  }
  return p;
}

/** يرسم زرّ Google الرسمي داخل العنصر (RN-web يمرّر عنصر DOM عبر ref) ويستدعي onToken برمز الهوية */
export async function renderGoogleButton(el: HTMLElement, clientId: string, locale: 'ar' | 'en', width: number, onToken: (idToken: string) => void): Promise<void> {
  await loadScript(GSI_SRC, () => !!window.google?.accounts?.id);
  const id = window.google!.accounts.id;
  id.initialize({ client_id: clientId, callback: (r) => { if (r.credential) onToken(r.credential); }, ux_mode: 'popup', itp_support: true, use_fedcm_for_prompt: true });
  el.innerHTML = '';
  id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center', width: Math.min(400, Math.max(200, Math.floor(width))), locale });
}

/** دخول Apple على الويب عبر نافذة منبثقة — يعيد null عند إغلاق النافذة من المستخدم */
export async function appleWebSignIn(servicesId: string): Promise<AppleResult | null> {
  await loadScript(APPLE_SRC, () => !!window.AppleID?.auth);
  window.AppleID!.auth.init({ clientId: servicesId, scope: 'name email', redirectURI: `${window.location.origin}/login`, usePopup: true });
  try {
    const r = await window.AppleID!.auth.signIn();
    return { identityToken: r.authorization.id_token, fullName: r.user?.name ? { givenName: r.user.name.firstName ?? null, familyName: r.user.name.lastName ?? null } : null };
  } catch (e) {
    const code = (e as { error?: string })?.error;
    if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return null;
    throw e;
  }
}

/* ---------- الجوال: وحدات أصلية مؤجّلة ---------- */
type AppleModule = typeof import('expo-apple-authentication');
type GoogleModule = typeof import('expo-auth-session/providers/google');

export function loadAppleNative(): AppleModule | null {
  if (Platform.OS !== 'ios') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try { return require('expo-apple-authentication') as AppleModule; } catch { return null; }
}
export function loadGoogleNative(): GoogleModule | null {
  if (Platform.OS === 'web') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try { return require('expo-auth-session/providers/google') as GoogleModule; } catch { return null; }
}

/** معرّفات عملاء Google الأصلية تُضمَّن وقت البناء — بدونها لا يظهر الزرّ على الجوال */
export const GOOGLE_NATIVE_IDS = { ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '', android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '' };
export const hasGoogleNative = (): boolean => Platform.OS === 'ios' ? !!GOOGLE_NATIVE_IDS.ios : Platform.OS === 'android' ? !!GOOGLE_NATIVE_IDS.android : false;

/** دخول Apple الأصلي — null عند الإلغاء */
export async function appleNativeSignIn(A: AppleModule): Promise<AppleResult | null> {
  try {
    const c = await A.signInAsync({ requestedScopes: [A.AppleAuthenticationScope.FULL_NAME, A.AppleAuthenticationScope.EMAIL] });
    if (!c.identityToken) return null;
    return { identityToken: c.identityToken, fullName: c.fullName ? { givenName: c.fullName.givenName, familyName: c.fullName.familyName } : null };
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}
