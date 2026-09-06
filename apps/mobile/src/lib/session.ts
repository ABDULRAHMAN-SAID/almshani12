import { router } from 'expo-router';
import { User, type AuthSession } from '@manassah/shared';
import { api } from '@/api/client';
import { tokens, useAuth } from '@/state/auth';

/** يُستدعى مرة عند الإقلاع: يحمّل الرموز ويجلب المستخدم — الجلسة تُجدَّد تلقائياً في العميل */
export async function bootstrapAuth(): Promise<void> {
  const { setUser, setReady } = useAuth.getState();
  try {
    await tokens.load();
    if (tokens.refresh) {
      const me = await api.get('/auth/me', User);
      setUser(me);
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
}

export async function signOut(): Promise<void> {
  try { if (tokens.refresh) await api.post('/auth/logout', { refreshToken: tokens.refresh }); } catch { /* يكفي مسح الرموز محلياً */ }
  await useAuth.getState().signOut();
  router.replace('/(auth)/welcome');
}

/** الوجهة الصحيحة حسب حالة الحساب */
export function homeFor(user: User | null): string {
  if (!user) return '/(auth)/welcome';
  if (!user.onboardingCompleted) return '/(auth)/setup';
  return '/(tabs)';
}
