import { Pressable, ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing, hitTarget, typography } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'info';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconEnd?: IconName;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: hitTarget, lg: 52 };
const PAD: Record<ButtonSize, number> = { sm: spacing[3], md: spacing[4], lg: spacing[5] };

/** الأحمر للفعل الرئيسي الواحد في الشاشة — الباقي secondary أو ghost */
export function Button({
  label, onPress, variant = 'primary', size = 'md', icon, iconEnd, loading, disabled, full, style, accessibilityLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const palette = PALETTE[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHT[size], paddingHorizontal: PAD[size], backgroundColor: pressed ? palette.bgPressed : palette.bg,
          borderColor: palette.border, borderWidth: palette.border ? 1 : 0 },
        full && styles.full,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 19} color={palette.fg} /> : null}
          <Text role={size === 'sm' ? 'caption' : 'button'} color={palette.fg} style={size === 'sm' && styles.smText}>{label}</Text>
          {iconEnd ? <Icon name={iconEnd} size={size === 'sm' ? 16 : 19} color={palette.fg} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const PALETTE: Record<ButtonVariant, { bg: string; bgPressed: string; fg: string; border?: string }> = {
  primary: { bg: colors.brand.primary, bgPressed: colors.brand.primaryDark, fg: colors.text.onPrimary },
  secondary: { bg: colors.bg.card, bgPressed: colors.bg.subtle, fg: colors.text.primary, border: colors.border.strong },
  ghost: { bg: 'transparent', bgPressed: colors.bg.subtle, fg: colors.brand.primary },
  danger: { bg: colors.state.danger, bgPressed: '#8F1E17', fg: colors.text.onPrimary },
  info: { bg: colors.state.info, bgPressed: '#264A61', fg: colors.text.onPrimary },
};

const styles = StyleSheet.create({
  base: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', minWidth: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  full: { alignSelf: 'stretch' },
  disabled: { opacity: 0.45 },
  smText: { fontSize: typography.small.size, lineHeight: typography.small.lineHeight },
});
