import { View, StyleSheet } from 'react-native';
import { radius, shadow, spacing, themed } from '@manassah/tokens';
import { brand } from '@manassah/shared';
import { Text } from './Text';

/**
 * شعار مصغّر يتصدّر شاشات الدخول/التسجيل/التحقّق — بلا هذا كانت الشاشة نموذجاً مجرّداً
 * (حقل وزرّ على خلفية فارغة) لا صفحة دخول حقيقية بهوية واضحة.
 */
export function AuthHeader() {
  return (
    <View style={styles.wrap}>
      <View style={styles.mark}><Text role="h2" tone="inverse">{brand.name.ar.slice(0, 1)}</Text></View>
      <Text role="bodyMedium" tone="brand">{brand.name.ar}</Text>
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing[1], marginBottom: spacing[2] },
  mark: {
    width: 56, height: 56, borderRadius: radius.lg, backgroundColor: c.brand.primary,
    alignItems: 'center', justifyContent: 'center', borderBottomWidth: 4, borderBottomColor: c.brand.primaryDark, ...shadow.card,
  },
}));
