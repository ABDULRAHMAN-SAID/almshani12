import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, ScreenSkeleton } from '@/ui';

/** وجهة الرابط العميق بعد بوابة الدفع: manassah://pay/success?order=… → صفحة الطلب */
export default function PaySuccess() {
  const router = useRouter();
  const { order } = useLocalSearchParams<{ order?: string }>();
  useEffect(() => { router.replace(order ? { pathname: `/order/${order}`, params: { state: 'poll' } } : '/(tabs)'); }, [order, router]);
  return <Screen bare><ScreenSkeleton /></Screen>;
}
