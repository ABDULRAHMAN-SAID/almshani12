import { Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** لون المادة — يلوّن الشريحة بلونها الخفيف */
  color?: string;
  softColor?: string;
  small?: boolean;
}

/** شريحة فلتر/تصنيف — حبّة مستديرة كبيرة، المختارة مملوءة بلونها (أو باللون المعكوس للسِمة حين لا لون لها) */
export function Chip({ label, selected, onPress, icon, color, softColor, small }: ChipProps) {
  const fg = selected ? (color ? colors.text.onPrimary : colors.text.inverse) : color ?? colors.text.primary;
  const bg = selected ? (color ?? colors.bg.inverse) : softColor ?? colors.bg.card;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip, small && styles.small,
        { backgroundColor: bg, borderColor: selected ? bg : softColor ? 'transparent' : colors.border.strong },
        pressed && styles.pressed,
      ]}
    >
      {icon ? <Icon name={icon} size={small ? 14 : 17} color={fg} /> : null}
      <Text role="caption" color={fg} style={!small && styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[1],
    height: 40, paddingHorizontal: spacing[4], borderRadius: radius.full, borderWidth: 1.5,
  },
  text: { fontSize: 14, lineHeight: 20 },
  small: { height: 30, paddingHorizontal: spacing[3] },
  pressed: { opacity: 0.8 },
});
