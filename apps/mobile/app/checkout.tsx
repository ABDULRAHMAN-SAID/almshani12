import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, Platform, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { brand } from '@manassah/shared';
import { Screen, Text, Icon, Button, Input, Card, Badge, RowSkeleton, type IconName } from '@/ui';
import { useCart, useBooking, useQuote, usePaymentMethods, useCheckout, useWallet, useAfterPurchase } from '@/features/queries';
import { errorMessageKey } from '@/api/client';
import { money, formatDateTime } from '@/lib/format';
import { useCountdown } from '@/lib/hooks';
import { useLearners } from '@/state/auth';

const ICON: Record<string, IconName> = { wallet: 'wallet', manual: 'bank', mock: 'card', thawani: 'card', stripe: 'card' };

/** الدفع: ملخّص واضح + وسيلة واحدة تُختار + زرّ واحد. البطاقات لا تُدخَل هنا أبداً — بوابة خارجية */
export default function Checkout() {
  const { t } = useTranslation();
  const router = useRouter();
  const p = useLocalSearchParams<{ bookingId?: string; items?: string; orderNumber?: string; expiresAt?: string }>();
  const bookingId = p.bookingId ? Number(p.bookingId) : null;
  const items = useMemo(() => { try { return p.items ? (JSON.parse(p.items) as { itemType: string; itemId: number }[]) : null; } catch { return null; } }, [p.items]);
  const booking = useBooking(bookingId ?? 0);
  const cart = useCart();
  const quote = useQuote();
  const methods = usePaymentMethods();
  const wallet = useWallet();
  const checkout = useCheckout();
  const afterPurchase = useAfterPurchase();
  const [provider, setProvider] = useState<string | null>(null);
  const [coupon, setCoupon] = useState('');
  const learners = useLearners();
  const left = useCountdown(booking.data?.status === 'pending_payment' ? (p.expiresAt || null) : null);

  useEffect(() => { if (items) quote.mutate({ items, couponCode: coupon.trim() || null }); }, [items, coupon]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (methods.data?.length && !provider) setProvider(methods.data.find(m => m.id !== 'manual')?.id ?? methods.data[0].id); }, [methods.data, provider]);

  // سطر الحصة يذكر المتعلّم عند تعدّد متعلّمي الحساب
  const forLearner = booking.data?.learner && learners.length > 1 ? ` · ${t('learners.forLearner', { name: booking.data.learner.displayName })}` : '';
  const lines = bookingId && booking.data ? [{ title: `${booking.data.subject.name} · ${booking.data.teacher.name}${forLearner}`, sub: formatDateTime(booking.data.startsAt), price: booking.data.price }]
    : items && quote.data ? quote.data.items.map(i => ({ title: i.title, sub: null, price: i.price }))
    : cart.data ? cart.data.items.map(i => ({ title: i.title, sub: i.teacherName, price: i.price })) : [];
  const total = bookingId ? booking.data?.price ?? 0 : items ? quote.data?.total ?? 0 : cart.data?.total ?? 0;
  const discount = items ? quote.data?.discount ?? 0 : bookingId ? 0 : cart.data?.discount ?? 0;
  const loading = (bookingId && booking.isLoading) || (!bookingId && !items && cart.isLoading) || methods.isLoading;
  const walletShort = provider === 'wallet' && (wallet.data?.balance ?? 0) < total;
  // لا دفع قبل أن يصل ما سيُدفع فعلاً (حجز/عرض سعر/سلة) — وإلا ظهر زرّ «ادفع ٠» في حالة الخطأ
  const ready = bookingId ? !!booking.data : items ? !!quote.data : !!cart.data;
  const expired = !!p.expiresAt && left === 0 && booking.data?.status === 'pending_payment';

  const pay = () => {
    if (!provider) return;
    // طلب الحصة يُنسَب لمتعلّم الحجز نفسه؛ غيره للمتعلّم النشط (يضيفه useCheckout)
    checkout.mutate({ provider: provider as never, bookingId: bookingId ?? undefined, items: items?.map(i => ({ itemType: i.itemType as never, itemId: i.itemId })), couponCode: items ? (coupon.trim() || null) : undefined, learnerId: booking.data?.learner?.id }, {
      onSuccess: async r => {
        if (r.paid) { afterPurchase(); router.replace({ pathname: `/order/${r.order.number}`, params: { state: 'paid' } }); return; }
        if (r.awaitingReview) { router.replace({ pathname: `/order/${r.order.number}`, params: { state: 'awaiting', instructions: JSON.stringify(r.instructions ?? {}) } }); return; }
        if (r.requiresRedirect && r.checkoutUrl) {
          if (Platform.OS === 'web') window.open(r.checkoutUrl, '_blank', 'noopener');
          else WebBrowser.openAuthSessionAsync(r.checkoutUrl, `${brand.scheme}://pay/success`).catch(() => {});
          router.replace({ pathname: `/order/${r.order.number}`, params: { state: 'poll', url: r.checkoutUrl } });
        }
      },
    });
  };

  return (
    <Screen onBack={() => router.back()} title={t('checkout.title')} loading={!!loading} error={booking.error ?? methods.error} onRetry={() => { booking.refetch(); methods.refetch(); }}
      footer={<Button label={expired ? t('checkout.expired') : t('cart.pay', { p: money(total) })} size="lg" full icon="lock" loading={checkout.isPending} disabled={!provider || !ready || walletShort || expired || total < 0} onPress={pay} />}>
      <View style={styles.wrap}>
        {bookingId && p.expiresAt && !expired ? <View style={styles.hold}><Icon name="clock" size={16} color={colors.state.warning} /><Text role="small" tone="warning" tabular>{t('booking.expiresIn', { m: Math.max(1, Math.ceil(left / 60)) })}</Text></View> : null}
        <Card>
          <Text role="h3" style={styles.mb}>{t('checkout.summary')}</Text>
          {lines.length === 0 && (quote.isPending || cart.isLoading) ? <RowSkeleton /> : lines.map((l, i) => (
            <View key={i} style={styles.line}><View style={styles.flex}><Text role="body" numberOfLines={2}>{l.title}</Text>{l.sub ? <Text role="caption" tone="secondary">{l.sub}</Text> : null}</View><Text role="body" tabular>{money(l.price)}</Text></View>
          ))}
          {discount > 0 ? <View style={styles.line}><Text role="body" tone="success">{t('cart.discount')}</Text><Text role="body" tone="success" tabular>−{money(discount)}</Text></View> : null}
          <View style={[styles.line, styles.total]}><Text role="h3">{t('cart.total')}</Text><Text role="price" tabular>{money(total)}</Text></View>
          {items ? <View style={styles.couponRow}><View style={styles.flex}><Input value={coupon} onChangeText={setCoupon} placeholder={t('cart.coupon')} autoCapitalize="characters" /></View></View> : null}
          {quote.error ? <Text role="small" tone="danger">{t(errorMessageKey(quote.error))}</Text> : null}
        </Card>

        <Text role="h3">{t('checkout.choose')}</Text>
        {(methods.data ?? []).map(m => {
          const on = provider === m.id;
          return (
            <Pressable key={m.id} onPress={() => setProvider(m.id)} style={[styles.method, on && styles.methodOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
              <View style={[styles.mIcon, on && styles.mIconOn]}><Icon name={ICON[m.id] ?? 'card'} size={20} color={on ? colors.brand.primary : colors.text.secondary} /></View>
              <View style={styles.flex}>
                <View style={styles.mTitle}><Text role="bodyMedium">{m.label}</Text>{m.mode === 'uat' || m.mode === 'test' ? <Badge label={t('checkout.testMode')} tone="warning" icon="sparkles" /> : null}</View>
                {m.description ? <Text role="caption" tone="secondary">{m.description}</Text> : null}
              </View>
              {m.id === 'wallet' && walletShort && on ? <Badge label={t('errors.insufficientFunds')} tone="danger" /> : null}
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <Icon name="check" size={14} color={colors.text.inverse} /> : null}</View>
            </Pressable>
          );
        })}
        {checkout.error ? <Text role="small" tone="danger">{t(errorMessageKey(checkout.error))}</Text> : null}
        <View style={styles.secure}><Icon name="lock" size={14} color={colors.state.success} /><Text role="caption" tone="secondary">{t('checkout.secure')}</Text></View>
      </View>
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  hold: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[3], backgroundColor: c.state.warningSoft, borderRadius: radius.md },
  mb: { marginBottom: spacing[2] },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[1] },
  total: { borderTopWidth: 1, borderTopColor: c.border.default, marginTop: spacing[2], paddingTop: spacing[3] },
  couponRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  method: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border.default, backgroundColor: c.bg.card, minHeight: 64 },
  methodOn: { borderColor: c.brand.primary },
  mTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  mIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.bg.subtle, alignItems: 'center', justifyContent: 'center' },
  mIconOn: { backgroundColor: c.brand.primarySoft },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.border.strong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: c.brand.primary, borderColor: c.brand.primary },
  secure: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], justifyContent: 'center' },
}));
