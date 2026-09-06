import { useQuery } from '@tanstack/react-query';
import { PublicConfig } from '@manassah/shared';
import { api } from '@/api/client';

export const configKey = ['server-config'] as const;

/** إعدادات الخادم العامة (GET /config): معرّفات الدخول الاجتماعي، مفتاح الإشعارات، وسائل الدفع — تُجلب مرة كل ١٠ دقائق بلا جلسة */
export const useServerConfig = () => useQuery({
  queryKey: configKey,
  queryFn: () => api.get('/config', PublicConfig, undefined, { auth: false }),
  staleTime: 10 * 60_000, retry: 1,
});
