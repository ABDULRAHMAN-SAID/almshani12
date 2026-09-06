import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { colors, typography, type TypographyRole } from '@manassah/tokens';

export type TextTone =
  | 'primary' | 'secondary' | 'tertiary' | 'inverse' | 'brand' | 'gold'
  | 'success' | 'info' | 'warning' | 'danger' | 'link';

const TONES: Record<TextTone, string> = {
  primary: colors.text.primary,
  secondary: colors.text.secondary,
  tertiary: colors.text.tertiary,
  inverse: colors.text.inverse,
  brand: colors.brand.primary,
  gold: colors.brand.gold,
  success: colors.state.success,
  info: colors.state.info,
  warning: colors.state.warning,
  danger: colors.state.danger,
  link: colors.text.link,
};

/** `role` هنا دور الخط لا دور الوصول — لذا نستبعد role الخاص بـ RN */
export interface TextProps extends Omit<RNTextProps, 'role'> {
  /** دور من سلّم الخط — لا أحجام عشوائية */
  role?: TypographyRole;
  tone?: TextTone;
  color?: string;
  center?: boolean;
  /** أرقام جدولية — للأسعار والأوقات والعدّادات */
  tabular?: boolean;
}

export function Text({ role = 'body', tone = 'primary', color, center, tabular, style, ...rest }: TextProps) {
  const t = typography[role];
  return (
    <RNText
      {...rest}
      style={[
        styles.base,
        { fontFamily: t.family, fontSize: t.size, lineHeight: t.lineHeight, color: color ?? TONES[tone] },
        center && styles.center,
        (tabular || role === 'price' || role === 'number') && styles.tabular,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { textAlign: 'auto', writingDirection: 'auto' },
  center: { textAlign: 'center' },
  tabular: { fontVariant: ['tabular-nums'] },
});
