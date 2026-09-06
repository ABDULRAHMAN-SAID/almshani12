import { router } from 'expo-router';
import { User, type AuthSession } from '@manassah/shared';
import { api, demoSetLearner } from '@/api/client';
import { tokens, useAuth, hydrateActiveLearner, needsSetup, setLearnerEffects } from '@/state/auth';
import { queryClient } from '@/lib/queryClient';
import { registerPush, unregisterPush } from '@/lib/push';

/** تبديل المتعلّم: نُبلغ الخادم (بلا انتظار) ونسخة العرض، ثم يُعاد جلب كل ما يعتمد على المتعلّم (الرئيسية، الحصص، التقدّم، المشتريات…) */
setLearnerEffects((id) => {
  demoSetLearner(id);
  if (id) api.post(`/me/learners/${id}/activate`).catch(() => { /* اختيار الجهاز يكفي؛ الخادم يعود للافتراضي */ });
  queryClient.invalidateQueries();
});

/** يُستدعى مرة عند الإقلاع: يحمّل الرموز والمتعلّم المحفوظ ويجلب المستخدم — الجلسة تُجدَّد تلقائياً في العميل */
export async function bootstrapAuth(): Promise<void> {
  const { setUser, setReady } = useAuth.getState();
  try {
    await Promise.all([tokens.load(), hydrateActiveLearner()]);
    if (tokens.refresh) {
      const me = await api.get('/auth/me', User);
      setUser(me);
      void registerPush(true); // إذن ممنوح سابقاً → نجدّد تسجيل الجهاز بصمت
    }
  } catch {
    // لا شبكة أو جلسة منتهية — نبدأ زائراً وتبقى الرموز حتى تُثبت صلاحيتها أو تُمسح عند 401
  } finally {
    setReady(true);
  }
}

export async function signIn(session: AuthSession): Promise<void> {
  await tokens.set(session.accessToken, session.refreshToken);
  useAuth.getState().setUser(session.user);
  void registerPush(false); // الجوال يطلب الإذن هنا؛ الويب يسجّل فقط إن كان الإذن ممنوحاً (المفتاح في الإعدادات)
}

export async function signOut(): Promise<void> {
  await unregisterPush(); // قبل مسح الرموز — يفكّ ارتباط الجهاز بالحساب
  try { if (tokens.refresh) await api.post('/auth/logout', { refreshToken: tokens.refresh }); } catch { /* يكفي مسح الرموز محلياً */ }
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
