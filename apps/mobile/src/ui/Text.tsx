import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';
import { colors, typography, type Colors, type TypographyRole } from '@manassah/tokens';
import { useUi } from '@/state/ui';

export type TextTone =
  | 'primary' | 'secondary' | 'tertiary' | 'inverse' | 'brand' | 'gold'
  | 'success' | 'info' | 'warning' | 'danger' | 'link';

/** تُحسب عند الرسم كي تتبع السِمة النشطة */
const tone = (c: Colors, t: TextTone): string => ({
  primary: c.text.primary,
  secondary: c.text.secondary,
  tertiary: c.text.tertiary,
  inverse: c.text.inverse,
  brand: c.brand.primary,
  gold: c.brand.goldDark,
  success: c.state.success,
  info: c.state.info,
  warning: c.state.warningText,
  danger: c.state.danger,
  link: c.text.link,
}[t]);

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

export function Text({ role = 'body', tone: t = 'primary', color, center, tabular, style, ...rest }: TextProps) {
  const ty = typography[role];
  // خيار «خط كبير» من الإعدادات — يكبّر كل النصوص بنسبة واحدة
  const scale = useUi(s => s.textScale);
  return (
    <RNText
      {...rest}
      style={[
        styles.base,
        { fontFamily: ty.family, fontSize: Math.round(ty.size * scale), lineHeight: Math.round(ty.lineHeight * scale), color: color ?? tone(colors, t) },
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
