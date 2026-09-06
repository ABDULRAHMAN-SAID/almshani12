import { Pressable, ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing, typography, type Colors } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'info' | 'success' | 'soft';
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

const HEIGHT: Record<ButtonSize, number> = { sm: 40, md: 52, lg: 60 };
const PAD: Record<ButtonSize, number> = { sm: spacing[4], md: spacing[5], lg: spacing[6] };
const EDGE = 4; // الحافة السفلية «الملموسة» — تعطي الزر إحساساً بالعمق وتظهر الضغط بوضوح

/** زر واحد أحمر للفعل الرئيسي في الشاشة — الباقي secondary أو soft أو ghost. كبير ومستدير وواضح */
export function Button({
  label, onPress, variant = 'primary', size = 'md', icon, iconEnd, loading, disabled, full, style, accessibilityLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const p = palette(colors)[variant];
  const iconSize = size === 'sm' ? 17 : 21;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size], paddingHorizontal: PAD[size],
          backgroundColor: pressed ? p.bgPressed : p.bg,
          borderColor: p.border ?? 'transparent', borderWidth: p.border ? 2 : 0,
          borderBottomWidth: p.edge ? EDGE : p.border ? 2 : 0, borderBottomColor: p.edge ?? p.border ?? 'transparent',
        },
        pressed && p.edge ? styles.pressedEdge : null,
        full && styles.full,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={iconSize} color={p.fg} /> : null}
          <Text role="button" color={p.fg} style={size === 'sm' && styles.smText} numberOfLines={1}>{label}</Text>
          {iconEnd ? <Icon name={iconEnd} size={iconSize} color={p.fg} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** تُحسب عند الرسم كي تتبع السِمة (فاتح/داكن) */
const palette = (c: Colors): Record<ButtonVariant, { bg: string; bgPressed: string; fg: string; border?: string; edge?: string }> => ({
  primary: { bg: c.brand.primary, bgPressed: c.brand.primaryDark, fg: c.text.onPrimary, edge: c.brand.primaryDark },
  success: { bg: c.brand.green, bgPressed: c.brand.greenDark, fg: c.text.onPrimary, edge: c.brand.greenDark },
  info: { bg: c.state.info, bgPressed: '#175A96', fg: c.text.onPrimary, edge: '#175A96' },
  danger: { bg: c.state.danger, bgPressed: '#8F1E17', fg: c.text.onPrimary, edge: '#8F1E17' },
  secondary: { bg: c.bg.card, bgPressed: c.bg.subtle, fg: c.text.primary, border: c.border.strong },
  soft: { bg: c.brand.primarySoft, bgPressed: c.brand.primarySoft, fg: c.brand.primary },
  ghost: { bg: 'transparent', bgPressed: c.bg.subtle, fg: c.brand.primary },
});

const styles = StyleSheet.create({
  base: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', minWidth: 72 },
  pressedEdge: { borderBottomWidth: 1, marginTop: EDGE - 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  full: { alignSelf: 'stretch' },
  disabled: { opacity: 0.45 },
  smText: { fontSize: typography.small.size, lineHeight: typography.small.lineHeight, fontFamily: typography.caption.family },
});
