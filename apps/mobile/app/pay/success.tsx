import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing } from '@manassah/tokens';
import { Screen, ScreenSkeleton, Text } from '@/ui';
import { useConfirmOrder } from '@/features/queries';

/**
 * وجهة العودة من بوابة الدفع (ويب: /pay/success؟order=… — جوال: manassah://pay/success؟order=…).
 * نسأل الخادم أن يتحقّق من المزوّد (POST /orders/:number/confirm؛ session_id تلميح Stripe) ثم ننتقل لصفحة الطلب —
 * حالة «poll» تُكمل الاستطلاع إن لم يصل التأكيد بعد.
 */
export default function PaySuccess() {
  const { t } = useTranslation();
  const router = useRouter();
  const { order, session_id: sessionId } = useLocalSearchParams<{ order?: string; session_id?: string }>();
  const confirm = useConfirmOrder(order ?? '');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    if (!order) { router.replace('/(tabs)'); return; }
    confirm.mutateAsync(sessionId ? { sessionId } : undefined)
      .then(r => router.replace({ pathname: `/order/${order}`, params: { state: r.paid ? 'paid' : 'poll' } }))
      .catch(() => router.replace({ pathname: `/order/${order}`, params: { state: 'poll' } }));
  }, [order, sessionId, confirm, router]);
  return (
    <Screen bare>
      <View style={styles.note}><Text role="small" tone="secondary" center>{t('checkout.confirming')}</Text></View>
      <ScreenSkeleton />
    </Screen>
  );
}

const styles = StyleSheet.create({ note: { paddingTop: spacing[6], paddingHorizontal: spacing[4] } });
