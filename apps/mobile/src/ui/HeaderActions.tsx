import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, hitTarget } from '@manassah/tokens';
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
  row: { flexDirection: 'row' },
  btn: { width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, end: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand.primary, borderWidth: 1.5, borderColor: colors.bg.base },
  count: { position: 'absolute', top: 6, end: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.brand.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  countText: { fontSize: 10, lineHeight: 12 },
});
