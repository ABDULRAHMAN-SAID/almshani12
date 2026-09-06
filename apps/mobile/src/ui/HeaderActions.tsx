import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, hitTarget, radius, spacing } from '@manassah/tokens';
import { Icon } from './Icon';
import { Text } from './Text';
import { useCart, useNotifications } from '@/features/queries';

/** أزرار الترويسة المشتركة: الإشعارات (بنقطة) والسلة (بعدّاد) */
export function HeaderActions({ cart = true, bell = true }: { cart?: boolean; bell?: boolean }) {
  const router = useRouter();
  const c = useCart();
  const n = useNotifications();
  const count = c.data?.items.length ?? 0;
  const unread = n.data?.unread ?? 0;
  return (
    <View style={styles.row}>
      {bell ? (
        <Pressable onPress={() => router.push('/account/notifications')} style={styles.btn} accessibilityRole="button" accessibilityLabel="الإشعارات">
          <Icon name="bell" size={22} />
          {unread > 0 ? <View style={styles.dot} /> : null}
        </Pressable>
      ) : null}
      {cart ? (
        <Pressable onPress={() => router.push('/cart')} style={styles.btn} accessibilityRole="button" accessibilityLabel="السلة">
          <Icon name="cart" size={22} />
          {count > 0 ? <View style={styles.count}><Text role="caption" tone="inverse" tabular style={styles.countText}>{count}</Text></View> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing[2] },
  btn: { width: hitTarget - 4, height: hitTarget - 4, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.card, borderWidth: 1.5, borderColor: colors.border.default },
  dot: { position: 'absolute', top: 8, end: 9, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand.primary, borderWidth: 2, borderColor: colors.bg.card },
  count: { position: 'absolute', top: -4, end: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: colors.bg.card },
  countText: { fontSize: 10, lineHeight: 12 },
});
