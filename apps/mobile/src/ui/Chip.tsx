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

/** شريحة فلتر/تصنيف — قابلة للاختيار */
export function Chip({ label, selected, onPress, icon, color, softColor, small }: ChipProps) {
  const fg = selected ? colors.text.onPrimary : color ?? colors.text.primary;
  const bg = selected ? (color ?? colors.text.primary) : softColor ?? colors.bg.card;
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
      {icon ? <Icon name={icon} size={small ? 13 : 15} color={fg} /> : null}
      <Text role={small ? 'caption' : 'small'} color={fg}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[1],
    height: 34, paddingHorizontal: spacing[3], borderRadius: radius.sm, borderWidth: 1,
  },
  small: { height: 26, paddingHorizontal: spacing[2] },
  pressed: { opacity: 0.8 },
});
