import { useEffect, useMemo, useState } from 'react';
import { View, Platform, AppState, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { Screen, Text, Icon, Button, Card, Badge } from '@/ui';
import { useOrder, useConfirmOrder, useAfterPurchase } from '@/features/queries';
import { money } from '@/lib/format';
import { useLearners } from '@/state/auth';

/** بوابات خارجية يُسأل المزوّد عنها (POST /orders/:number/confirm)؛ الباقي (محاكاة/محفظة/تحويل) يُحدَّث من الخادم مباشرة */
const GATEWAYS = ['thawani', 'stripe'];

/** حالة الطلب: نجاح / بانتظار البوابة (تحديث تلقائي) / إلغاء من البوابة / تحويل بنكي / فشل — والفعل التالي واضح */
export default function OrderStatus() {
  const { t } = useTranslation();
  const router = useRouter();
  const { number, state, instructions, url } = useLocalSearchParams<{ number: string; state?: string; instructions?: string; url?: string }>();
  const confirm = useConfirmOrder(number);
  const [askProvider, setAskProvider] = useState(false);
  const afterPurchase = useAfterPurchase();
  const [copied, setCopied] = useState(false);
  const learners = useLearners();
  const bank = useMemo(() => { try { return instructions ? JSON.parse(instructions) as Record<string, string> : null; } catch { return null; } }, [instructions]);

  // بانتظار بوابة خارجية: نسأل المزوّد كل ٤ ثوانٍ وعند العودة للتطبيق/التبويب؛ غير ذلك يكفي جلب الطلب كل ٢٫٥ ثانية
  const order = useOrder(number, state === 'poll' && !askProvider);
  const o = order.data;
  const gateway = !!o?.provider && GATEWAYS.includes(o.provider);
  const waitingGateway = state === 'poll' && o?.status === 'pending' && gateway;
  useEffect(() => { setAskProvider(waitingGateway); }, [waitingGateway]);
  useEffect(() => {
    if (!waitingGateway) return;
    let busy = false;
    const run = () => { if (busy) return; busy = true; confirm.mutate(undefined, { onSettled: () => { busy = false; } }); };
    run();
    const id = setInterval(run, 4000);
    const onVisible = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') run(); };
    const sub = AppState.addEventListener('change', s => { if (s === 'active') run(); });
    if (Platform.OS === 'web' && typeof document !== 'undefined') { document.addEventListener('visibilitychange', onVisible); window.addEventListener('focus', onVisible); }
    return () => {
      clearInterval(id); sub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); }
    };
  }, [waitingGateway, number]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (o?.status === 'paid') afterPurchase(); }, [o?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = o?.items[0];
  const goNext = () => {
    if (!first) return router.replace('/(tabs)');
    if (first.itemType === 'lesson') return router.replace(`/lesson/${first.itemId}`);
    if (first.itemType === 'book') return router.replace(`/book/${first.itemId}/read`);
    if (first.itemType === 'course') return router.replace(`/course/${first.itemId}`);
    return router.replace('/(tabs)/lessons');
  };
  const nextLabel = first?.itemType === 'lesson' ? t('checkout.viewLesson') : first?.itemType === 'book' ? t('library.read') : first?.itemType === 'course' ? t('courses.start') : t('lessons.packages');
  const paid = o?.status === 'paid' || o?.status === 'partially_refunded';
  // طلب حصة: نصّ التأكيد يخصّ الحصة لا المكتبة، ويُذكر المتعلّم عند تعدّد متعلّمي الحساب
  const lessonOrder = first?.itemType === 'lesson';
  const forLearner = o?.learner && learners.length > 1 ? ` · ${t('learners.forLearner', { name: o.learner.displayName })}` : '';
  const failed = o?.status === 'failed' || o?.status === 'expired' || o?.status === 'cancelled';
  const awaiting = !paid && !failed && (state === 'awaiting' || o?.provider === 'manual');
  // ألغى المستخدم في البوابة والطلب ما زال معلّقاً — لم يُخصم شيء، يمكنه المحاولة مجدداً
  const cancelled = !paid && !failed && !awaiting && state === 'cancelled';
  const retry = () => router.replace(lessonOrder && first ? { pathname: '/checkout', params: { bookingId: String(first.itemId) } } : '/cart');

  const title = paid ? t(lessonOrder ? 'cart.successLesson' : 'cart.success') : failed ? t('cart.failed') : awaiting ? t('cart.awaiting') : cancelled ? t('checkout.cancelled') : t('checkout.waiting');
  const body = paid ? t(lessonOrder ? 'cart.successLessonBody' : 'cart.successBody') : failed ? t('cart.failedBody') : awaiting ? t('cart.awaitingBody') : cancelled ? t('checkout.cancelledBody') : gateway ? t('checkout.confirming') : t('checkout.redirecting');

  return (
    <Screen onBack={() => router.replace('/(tabs)')} title={t('checkout.orderNumber')} loading={order.isLoading} error={order.error} onRetry={() => order.refetch()}>
      {o ? (
        <View style={styles.wrap}>
          <Card accent>
            <View style={styles.head}>
              <View style={[styles.icon, paid ? styles.ok : failed || cancelled ? styles.bad : styles.wait]}><Icon name={paid ? 'checkCircle' : failed || cancelled ? 'warning' : 'clock'} size={34} color={colors.text.inverse} /></View>
              <Text role="h2" center>{title}</Text>
              <Text role="small" tone="secondary" center>{body}</Text>
              <Badge label={`${o.number} · ${t(`purchasesUi.status.${o.status}`)}`} tone={paid ? 'success' : failed ? 'danger' : 'warning'} />
            </View>
          </Card>
          <Card>
            {o.items.map((it, i) => <View key={i} style={styles.line}><Text role="body" style={styles.flex} numberOfLines={2}>{it.title}{it.itemType === 'lesson' ? forLearner : ''}</Text><Text role="body" tabular>{money(it.unitPrice)}</Text></View>)}
            <View style={[styles.line, styles.total]}><Text role="h3">{t('cart.total')}</Text><Text role="price" tabular>{money(o.total)}</Text></View>
          </Card>
          {awaiting && bank ? (
            <Card>
              <Text role="h3" style={styles.mb}>{t('checkout.bank')}</Text>
              {Object.entries(bank).map(([k, v]) => <View key={k} style={styles.line}><Text role="caption" tone="secondary">{k}</Text><Text role="bodyMedium" tabular selectable>{v}</Text></View>)}
              <Button label={copied ? t('ui.copied') : t('ui.copy')} variant="secondary" size="sm" icon="copy" onPress={async () => { await Clipboard.setStringAsync(Object.values(bank).join('\n')); setCopied(true); }} />
            </Card>
          ) : null}
          {cancelled ? <Button label={t('common.retry')} icon="card" full onPress={retry} /> : null}
          {!paid && !failed && !awaiting && !cancelled ? (
            <View style={styles.actions}>
              {url ? <Button label={t('checkout.openGateway')} variant="secondary" icon="card" full onPress={() => Platform.OS === 'web' ? window.open(url, '_blank', 'noopener') : router.push(url as never)} /> : null}
              <Button label={t('checkout.checkStatus')} icon="refresh" full loading={order.isFetching || confirm.isPending} onPress={() => gateway ? confirm.mutate(undefined) : order.refetch()} />
              <Text role="caption" tone="tertiary" center>{t('checkout.paidElsewhere')}</Text>
            </View>
          ) : null}
          {paid ? <Button label={nextLabel} size="lg" full onPress={goNext} /> : null}
          {failed ? <Button label={t('common.retry')} full onPress={() => router.replace('/cart')} /> : null}
          <Button label={t('checkout.backHome')} variant="ghost" full onPress={() => router.replace('/(tabs)')} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  head: { alignItems: 'center', gap: spacing[2] },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[1] },
  ok: { backgroundColor: c.state.success }, bad: { backgroundColor: c.state.danger }, wait: { backgroundColor: c.state.warning },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[1] },
  total: { borderTopWidth: 1, borderTopColor: c.border.default, marginTop: spacing[2], paddingTop: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  mb: { marginBottom: spacing[2] },
  actions: { gap: spacing[2] },
  bankNote: { borderRadius: radius.md },
}));
