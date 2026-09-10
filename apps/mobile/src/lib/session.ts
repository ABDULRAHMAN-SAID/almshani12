import { router } from 'expo-router';
import { Platform } from 'react-native';
import { User, type AuthSession } from '@manassah/shared';
import { api, demoSetLearner, sessionBase } from '@/api/client';
import { tokens, useAuth, hydrateActiveLearner, needsSetup, setLearnerEffects } from '@/state/auth';
import { queryClient } from '@/lib/queryClient';
import { registerPush, unregisterPush } from '@/lib/push';
import { readPrefsSync } from '@/lib/prefs';
import { useUi } from '@/state/ui';

/** تبديل المتعلّم: نُبلغ الخادم (بلا انتظار) ونسخة العرض، ثم يُعاد جلب كل ما يعتمد على المتعلّم (الرئيسية، الحصص، التقدّم، المشتريات…) */
setLearnerEffects((id) => {
  demoSetLearner(id);
  if (id) api.post(`/me/learners/${id}/activate`).catch(() => { /* اختيار الجهاز يكفي؛ الخادم يعود للافتراضي */ });
  queryClient.invalidateQueries();
});

/**
 * الويب: التبويبات تتشارك التخزين نفسه، وتبويب يجدّد الجلسة يُدوّر رمز التجديد. الخادم يعتبر إعادة استخدام رمز
 * مُدوَّر سرقةً فيُبطل جلسات الحساب على كل أجهزته — لذا نُزامن نسخة الذاكرة مع التخزين فور كتابته من تبويب آخر.
 */
if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('storage', () => { void tokens.load(); });

/** يُستدعى مرة عند الإقلاع: يحمّل الرموز والمتعلّم المحفوظ ويجلب المستخدم — الجلسة تُجدَّد تلقائياً في العميل */
export async function bootstrapAuth(): Promise<void> {
  const { setUser, setReady, setBootOffline } = useAuth.getState();
  setBootOffline(false);
  try {
    await Promise.all([tokens.load(), hydrateActiveLearner()]);
    if (tokens.refresh) {
      const me = await api.get('/auth/me', User);
      setUser(me);
      // لغة الحساب تُتبنّى على جهاز لم يُختَر فيه لغة بعد (اختيار الجهاز يبقى الأقوى)
      if (!readPrefsSync().locale) useUi.getState().setLocale(me.locale);
      void registerPush(true); // إذن ممنوح سابقاً → نجدّد تسجيل الجهاز بصمت
    }
  } catch (e) {
    // جلسة منتهية (٤٠١ يمسح الرموز في العميل) → زائر. أمّا تعذّر الوصول للخادم فليس خروجاً:
    // الرموز باقية، فنعلنها انقطاعاً بإعادة محاولة بدل أن نُلقي المستخدم على شاشة الترحيب.
    if (tokens.refresh && !isAuthError(e)) setBootOffline(true);
  } finally {
    setReady(true);
  }
}

/** ٤٠١/٤٠٣ من الخادم = الجلسة انتهت؛ أي شيء آخر (شبكة، مهلة، نفق ميت) = انقطاع */
const isAuthError = (e: unknown): boolean => {
  const st = (e as { status?: number } | null)?.status;
  return st === 401 || st === 403;
};

export async function signIn(session: AuthSession): Promise<void> {
  // تخزين غير متاح: الجلسة تعمل في هذه الجولة فقط ولا تُحفظ — نعلن ذلك بدل أن نتركه يظهر «خروجاً» غامضاً عند الإقلاع
  if (!(await tokens.set(session.accessToken, session.refreshToken)) && __DEV__) console.warn('[auth] تعذّر حفظ الرموز — الجلسة في الذاكرة فقط');
  useAuth.getState().setUser(session.user);
  void registerPush(false); // الجوال يطلب الإذن هنا؛ الويب يسجّل فقط إن كان الإذن ممنوحاً (المفتاح في الإعدادات)
}

/** خروج واحد مهما تعدّدت الاستدعاءات المتزامنة (شاشة الاتصال بخادم تخرج صراحةً، والتخطيط الجذري يخرج عند تغيّر الخادم) */
let signingOut: Promise<void> | null = null;
export function signOut(): Promise<void> {
  if (!signingOut) signingOut = doSignOut().finally(() => { signingOut = null; });
  return signingOut;
}

async function doSignOut(): Promise<void> {
  // الخروج يقصد الخادم مُصدِر الرموز لا العنوان الحالي: تبديل الخادم يُغيّر العنوان فوراً، وإرسال رمز التجديد
  // إلى خادم آخر يسرّبه ويترك الجلسة القديمة صالحة عليه شهرين
  const base = sessionBase();
  await unregisterPush(base); // قبل مسح الرموز — يفكّ ارتباط الجهاز بالحساب
  try { if (tokens.refresh) await api.post('/auth/logout', { refreshToken: tokens.refresh }, undefined, { base }); } catch { /* يكفي مسح الرموز محلياً */ }
  await useAuth.getState().signOut();
  queryClient.clear();
  router.replace('/(auth)/welcome');
}

/** الوجهة الصحيحة حسب حالة الحساب: بلا متعلّم (وليس معلّماً/طاقماً) → الإعداد */
export function homeFor(user: User | null): string {
  if (!user) return '/(auth)/welcome';
  if (needsSetup(user)) return '/(auth)/setup';
  return '/(tabs)';
}

/**
 * زرّ عودة لا يعمل: `router.back()` بلا سجلّ تنقّل يرجع إليه لا يفعل شيئاً — صامتاً بلا أي خطأ.
 * هذا يحدث كلما فُتحت الشاشة مباشرة برابط (نسخة الويب في متصفّح، رابط عميق، أو استعادة تبويب)
 * لا بالتنقّل داخل التطبيق. نتحقّق من وجود سجلّ فعلاً قبل الاعتماد عليه، وإلا نذهب للرئيسية.
 */
export function safeBack(router: { canGoBack: () => boolean; back: () => void; replace: (href: never) => void }): void {
  if (router.canGoBack()) router.back();
  else router.replace(homeFor(useAuth.getState().user) as never);
}
