import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, ScreenSkeleton } from '@/ui';

export default function PayCancel() {
  const router = useRouter();
  const { order } = useLocalSearchParams<{ order?: string }>();
  useEffect(() => { router.replace(order ? { pathname: `/order/${order}`, params: { state: 'cancel' } } : '/cart'); }, [order, router]);
  return <Screen bare><ScreenSkeleton /></Screen>;
}
