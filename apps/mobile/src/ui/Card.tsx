import type { ReactNode } from 'react';
import { View, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing, shadow } from '@manassah/tokens';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  padded?: boolean;
  /** إطار ذهبي — لمسة الهوية، تُصرف بحذر (الحصة القادمة، شارة معتمد) */
  accent?: boolean;
  /** لون شريط الحافة البادئة — لبطاقات المواد */
  rail?: string;
  /** خلفية ملوّنة خفيفة بدل الأبيض (بلاطات الإجراءات) */
  tint?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/** السطح الأساسي: أبيض، زوايا ٢٢، حدّ ناعم وظلّ خفيف — كبير ومريح */
export function Card({ children, onPress, padded = true, accent, rail, tint, style, accessibilityLabel }: CardProps) {
  const base = [
    styles.card, padded && styles.padded, accent && styles.accent,
    rail ? { borderStartWidth: 6, borderStartColor: rail } : null,
    tint ? { backgroundColor: tint, borderColor: 'transparent' } : null,
    style,
  ];
  if (!onPress) return <View style={base}>{children}</View>;
  // Pressable هو الحاوية نفسها حتى تعمل أنماط التخطيط (العرض/flex) من الأب على البطاقة مباشرة
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.card, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: colors.border.default, ...shadow.card, overflow: 'hidden',
  },
  padded: { padding: spacing[4] },
  accent: { borderWidth: 2, borderColor: colors.brand.gold },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
});
