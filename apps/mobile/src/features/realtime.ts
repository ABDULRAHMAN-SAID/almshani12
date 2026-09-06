import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, isDemo } from '@/api/client';
import { tokens, useAuth } from '@/state/auth';
import { useUi } from '@/state/ui';
import { signOut } from '@/lib/session';
import i18n from '@/i18n';

/**
 * مقبس الإشعارات العام (المساحة «/» — غرفة user:<id> على الخادم):
 * عند إيقاف الحساب أو إنهاء الجلسات من الإدارة يصل `session_revoked` فنُخرج المستخدم فوراً مع رسالة واضحة.
 * لا اتصال في نسخة العرض ولا للزائر.
 */
export function useSessionSocket(): void {
  const userId = useAuth(s => s.user?.id ?? null);
  useEffect(() => {
    if (!userId || isDemo() || !tokens.access) return;
    const s: Socket = io(api.base, {
      auth: (cb) => cb({ token: tokens.access }),   // يُعاد تقييمه عند كل إعادة اتصال — الرمز يتجدّد
      transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 15_000, timeout: 8000,
    });
    s.on('session_revoked', () => { s.close(); useUi.getState().showToast(i18n.t('errors.authExpired')); signOut(); });
    s.on('connect_error', () => { /* صامت — الإشعارات الفورية كمالية، والتطبيق يعمل بلا مقبس */ });
    return () => { s.removeAllListeners(); s.close(); };
  }, [userId]);
}
