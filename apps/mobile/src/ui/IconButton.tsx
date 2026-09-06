import { Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, radius } from '@manassah/tokens';
import { Icon, type IconName } from './Icon';

export interface IconButtonProps {
  icon: IconName;
  onPress?: () => void;
  label: string;
  /** soft: خلفية ملوّنة خفيفة؛ secondary: أبيض بحدّ */
  variant?: 'secondary' | 'soft' | 'primary';
  size?: number;
  loading?: boolean;
  disabled?: boolean;
  color?: string;
}

/** زر دائري بأيقونة فقط — للفعل الثانوي بجانب زر رئيسي كبير (السلة، المراسلة، التعديل) */
export function IconButton({ icon, onPress, label, variant = 'secondary', size = 52, loading, disabled, color }: IconButtonProps) {
  const fg = color ?? (variant === 'primary' ? colors.text.onPrimary : variant === 'soft' ? colors.brand.primaryDark : colors.text.primary);
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.base, styles[variant], { width: size, height: size }, pressed && styles.pressed, (disabled || loading) && styles.disabled]}>
      {loading ? <ActivityIndicator color={fg} /> : <Icon name={icon} size={Math.round(size * 0.44)} color={fg} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.bg.card, borderWidth: 2, borderColor: colors.border.strong },
  soft: { backgroundColor: colors.brand.primarySoft },
  primary: { backgroundColor: colors.brand.primary },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
});
