import { View, StyleSheet } from 'react-native';
import { radius, shadow, spacing, themed } from '@manassah/tokens';
import { brand } from '@manassah/shared';
import { Text } from './Text';
import { Icon } from './Icon';

/**
 * شعار مصغّر يتصدّر شاشات الدخول/التسجيل/الاستعادة — بلا هذا كانت الشاشة نموذجاً مجرّداً
 * (حقل وزرّ على خلفية فارغة) لا صفحة دخول حقيقية بهوية واضحة. أيقونة حقيقية لا حرف أول
 * وحيد — الحرف الأول كان يبدو كـ"شعار" غير مكتمل، وهذا ملف مؤقّت ريثما يُصمَّم شعار نهائي
 * (شعار التطبيق الفعلي في assets/icon.png قالب مولّد لم يُصمَّم بعد أيضاً).
 */
export function AuthHeader() {
  return (
    <View style={styles.wrap}>
      <View style={styles.mark}><Icon name="bulb" size={30} color="#FFFFFF" /></View>
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
