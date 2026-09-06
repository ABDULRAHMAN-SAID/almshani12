import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, ScreenSkeleton } from '@/ui';

/** العودة من البوابة بعد الإلغاء: صفحة الطلب بحالة «cancelled» (لم يُخصم شيء — يمكن المحاولة مجدداً) */
export default function PayCancel() {
  const router = useRouter();
  const { order } = useLocalSearchParams<{ order?: string }>();
  useEffect(() => { router.replace(order ? { pathname: `/order/${order}`, params: { state: 'cancelled' } } : '/cart'); }, [order, router]);
  return <Screen bare><ScreenSkeleton /></Screen>;
}
