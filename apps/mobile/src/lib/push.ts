import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api, isDemo } from '@/api/client';
import { tokens } from '@/state/auth';
import { inlineAssets } from '@/lib/inline';

/**
 * الإشعارات الفورية: على الويب عبر عامل الخدمة /sw.js وWeb Push (مفتاح VAPID من الخادم)،
 * وعلى الجوال عبر رمز Expo (يتطلّب projectId من EAS). يُسجَّل الجهاز عند الدخول ويُلغى عند الخروج.
 * الوحدات الأصلية تُحمَّل عند الحاجة فقط كي تبقى حزمة الويب سليمة.
 */
/** unconfigured = بناء أصلي بلا EAS projectId (خلل ضبط لا قصور جهاز) */
export type PushState = 'on' | 'off' | 'denied' | 'unsupported' | 'unconfigured';

const SW_PATH = '/sw.js';
/** آخر رمز Expo سُجِّل على هذا الجهاز في هذه الجلسة */
let nativeToken: string | null = null;

const webSupported = (): boolean =>
  Platform.OS === 'web' && typeof window !== 'undefined' && !inlineAssets() && window.isSecureContext
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** المفتاح العام base64url → Uint8Array كما يتوقّعه pushManager.subscribe */
function vapidBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function webRegistration(): Promise<ServiceWorkerRegistration | null> {
  try { return (await navigator.serviceWorker.getRegistration(SW_PATH)) ?? (await navigator.serviceWorker.register(SW_PATH)); }
  catch { return null; }
}

/* ---------- الجوال (Expo) ---------- */
type Notif = typeof import('expo-notifications');
function loadNotifications(): Notif | null {
  if (Platform.OS === 'web') return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try { return require('expo-notifications') as Notif; } catch { return null; }
}
const projectId = (): string | null => {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
};

async function nativeState(N: Notif): Promise<PushState> {
  const p = await N.getPermissionsAsync();
  if (p.status === 'denied' && !p.canAskAgain) return 'denied';
  return p.granted && nativeToken ? 'on' : 'off';
}

async function nativeEnable(N: Notif, silent: boolean): Promise<PushState> {
  const pid = projectId();
  if (!pid) return 'unconfigured';
  let p = await N.getPermissionsAsync();
  if (!p.granted) {
    if (silent) return p.status === 'denied' && !p.canAskAgain ? 'denied' : 'off';
    p = await N.requestPermissionsAsync();
    if (!p.granted) return 'denied';
  }
  if (Platform.OS === 'android') await N.setNotificationChannelAsync('default', { name: 'default', importance: N.AndroidImportance.DEFAULT }).catch(() => null);
  const token = (await N.getExpoPushTokenAsync({ projectId: pid })).data;
  await api.post('/me/push', { kind: 'expo', token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  nativeToken = token;
  return 'on';
}

/* ---------- الواجهة العامة ---------- */
/** حالة التنبيهات على هذا الجهاز — بلا أي طلب إذن */
export async function getPushState(): Promise<PushState> {
  if (Platform.OS === 'web') {
    if (!webSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try { const sub = await (await navigator.serviceWorker.getRegistration(SW_PATH))?.pushManager.getSubscription(); return sub ? 'on' : 'off'; }
    catch { return 'off'; }
  }
  const N = loadNotifications();
  if (!N) return 'unsupported';
  if (!projectId()) return 'unconfigured';
  try { return await nativeState(N); } catch { return 'unsupported'; }
}

/**
 * تفعيل التنبيهات وتسجيل الجهاز للحساب الحالي. silent = بلا طلب إذن (عند الإقلاع والدخول): يُسجَّل فقط إن كان الإذن ممنوحاً من قبل.
 * لا يرمي أبداً — يعيد الحالة النهائية.
 */
export async function enablePush(opts: { silent?: boolean } = {}): Promise<PushState> {
  if (!tokens.access || isDemo()) return 'off';
  try {
    if (Platform.OS === 'web') {
      if (!webSupported()) return 'unsupported';
      if (Notification.permission === 'denied') return 'denied';
      if (Notification.permission !== 'granted') {
        if (opts.silent) return 'off';
        if ((await Notification.requestPermission()) !== 'granted') return 'denied';
      }
      const reg = await webRegistration();
      if (!reg) return 'unsupported';
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { key } = await api.get<{ key: string | null }>('/push/public-key', undefined, undefined, { auth: false });
        if (!key) return 'unsupported';
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(key) });
      }
      const j = sub.toJSON();
      if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return 'off';
      await api.post('/me/push', { kind: 'web', subscription: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } }, platform: 'web' });
      return 'on';
    }
    const N = loadNotifications();
    if (!N) return 'unsupported';
    return await nativeEnable(N, !!opts.silent);
  } catch (e) {
    if (__DEV__) console.warn('[push] enable failed', e);
    return Platform.OS === 'web' ? 'off' : 'unsupported';
  }
}

/** إلغاء تسجيل هذا الجهاز عن الحساب الحالي (يُستدعى قبل مسح الرموز عند الخروج) وإلغاء اشتراك المتصفح */
export async function disablePush(opts: { keepSubscription?: boolean; base?: string } = {}): Promise<PushState> {
  try {
    if (Platform.OS === 'web') {
      if (!webSupported()) return 'unsupported';
      const sub = await (await navigator.serviceWorker.getRegistration(SW_PATH))?.pushManager.getSubscription();
      if (!sub) return 'off';
      if (tokens.access && !isDemo()) await api.delete('/me/push', undefined, { kind: 'web', endpoint: sub.endpoint }, { base: opts.base }).catch(() => null);
      if (!opts.keepSubscription) await sub.unsubscribe().catch(() => false);
      return opts.keepSubscription ? 'on' : 'off';
    }
    if (nativeToken && tokens.access && !isDemo()) await api.delete('/me/push', undefined, { kind: 'expo', token: nativeToken }, { base: opts.base }).catch(() => null);
    nativeToken = null;
    return 'off';
  } catch { return 'off'; }
}

/** عند الدخول/الإقلاع: تسجيل صامت (لا يطلب الإذن على الويب؛ يطلبه على الجوال عند الدخول فقط) */
export const registerPush = (silent = true) => enablePush({ silent: Platform.OS === 'web' || silent }).catch(() => 'off' as PushState);
/** عند الخروج: فكّ ارتباط الجهاز بالحساب (على الخادم مُصدِر الرموز) مع إبقاء اشتراك المتصفح للدخول التالي */
export const unregisterPush = (base?: string) => disablePush({ keepSubscription: true, base }).catch(() => 'off' as PushState);
