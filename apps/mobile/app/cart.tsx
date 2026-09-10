import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { Screen, Text, Icon, Button, Input, Card, Price, EmptyState } from '@/ui';
import { useCart, useRemoveFromCart, useApplyCoupon } from '@/features/queries';
import { errorMessageKey } from '@/api/client';
import { money } from '@/lib/format';
import { safeBack } from '@/lib/session';

/** السلة: عناصر، إزالة، كوبون، تفصيل الإجمالي — ثم إتمام الشراء */
export default function Cart() {
  const { t } = useTranslation();
  const router = useRouter();
  const cart = useCart();
  const remove = useRemoveFromCart();
  const coupon = useApplyCoupon();
  const [code, setCode] = useState('');
  const c = cart.data;

  return (
    <Screen onBack={() => safeBack(router)} title={t('cart.title')} loading={cart.isLoading} error={cart.error} onRetry={() => cart.refetch()}
      empty={!!c && c.items.length === 0} emptyProps={{ icon: 'cart', title: t('cart.empty'), body: t('cart.emptyHint'), actionLabel: t('library.explore'), onAction: () => router.replace('/(tabs)/library') }}
      footer={c && c.items.length ? <Button label={t('cart.pay', { p: money(c.total) })} size="lg" full icon="lock" onPress={() => router.push('/checkout')} /> : undefined}>
      {c && c.items.length ? (
        <View style={styles.wrap}>
          {c.items.map(it => (
            <Card key={it.id} style={styles.item}>
              <View style={[styles.thumb, { backgroundColor: colors.bg.subtle }]}><Icon name={it.itemType === 'book' ? 'book' : 'courses'} size={22} color={colors.text.secondary} /></View>
              <View style={styles.flex}><Text role="bodyMedium" numberOfLines={2}>{it.title}</Text>{it.teacherName ? <Text role="caption" tone="secondary">{it.teacherName}</Text> : null}<Price value={it.price} listPrice={it.listPrice > it.price ? it.listPrice : null} size="sm" /></View>
              <Button label={t('cart.remove')} variant="ghost" size="sm" icon="trash" loading={remove.isPending} onPress={() => remove.mutate(it.id)} />
            </Card>
          ))}
          <Card>
            <Text role="h3" style={styles.mb}>{t('cart.coupon')}</Text>
            {c.coupon ? <View style={styles.couponOn}><Icon name="checkCircle" size={18} color={colors.state.success} /><Text role="bodyMedium" style={styles.flex}>{c.coupon.code} — {c.coupon.type === 'percentage' ? `${c.coupon.value}٪` : money(c.coupon.value)}</Text><Button label={t('cart.remove')} variant="ghost" size="sm" onPress={() => coupon.mutate(null)} /></View>
              : <View style={styles.couponRow}><View style={styles.flex}><Input value={code} onChangeText={setCode} placeholder={t('cart.coupon')} autoCapitalize="characters" /></View><Button label={t('cart.applyCoupon')} variant="secondary" loading={coupon.isPending} disabled={!code.trim()} onPress={() => coupon.mutate(code.trim(), { onSuccess: () => setCode('') })} /></View>}
            {coupon.error ? <Text role="small" tone="danger">{t(errorMessageKey(coupon.error))}</Text> : null}
          </Card>
          <Card>
            <View style={styles.line}><Text role="body" tone="secondary">{t('cart.subtotal')}</Text><Text role="body" tabular>{money(c.subtotal)}</Text></View>
            {c.discount > 0 ? <View style={styles.line}><Text role="body" tone="success">{t('cart.discount')}</Text><Text role="body" tone="success" tabular>−{money(c.discount)}</Text></View> : null}
            {c.tax > 0 ? <View style={styles.line}><Text role="body" tone="secondary">{t('cart.tax')}</Text><Text role="body" tabular>{money(c.tax)}</Text></View> : null}
            <View style={[styles.line, styles.total]}><Text role="h3">{t('cart.total')}</Text><Text role="price" tabular>{money(c.total)}</Text></View>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  thumb: { width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  mb: { marginBottom: spacing[2] },
  couponRow: { flexDirection: 'row', gap: spacing[2], alignItems: 'flex-start' },
  couponOn: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[1] },
  total: { borderTopWidth: 1, borderTopColor: c.border.default, marginTop: spacing[2], paddingTop: spacing[3] },
}));
