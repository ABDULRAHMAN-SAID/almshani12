import type { ReactNode } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export interface ListRowProps {
  icon?: IconName;
  /** لون دائرة الأيقونة — يجعل القائمة سهلة المسح بالعين */
  color?: string;
  label: string;
  value?: string | null;
  badge?: number;
  onPress?: () => void;
  danger?: boolean;
  right?: ReactNode;
  last?: boolean;
}

/** صفّ قائمة موحّد (حسابي، الإعدادات): أيقونة في دائرة ملوّنة + عنوان + قيمة/شارة + سهم */
export function ListRow({ icon, color, label, value, badge, onPress, danger, right, last }: ListRowProps) {
  const tint = danger ? colors.state.danger : color ?? colors.text.secondary;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, !last && styles.border, pressed && styles.pressed]}>
      {icon ? <View style={[styles.icon, { backgroundColor: danger ? colors.state.dangerSoft : color ? `${color}1F` : colors.bg.subtle }]}><Icon name={icon} size={21} color={tint} /></View> : null}
      <Text role="bodyMedium" tone={danger ? 'danger' : 'primary'} style={styles.label} numberOfLines={1}>{label}</Text>
      {value ? <Text role="small" tone="secondary" tabular numberOfLines={1}>{value}</Text> : null}
      {badge ? <View style={styles.badge}><Text role="caption" tone="inverse" tabular>{badge}</Text></View> : null}
      {right}
      {onPress && !right ? <Icon name="forward" size={18} color={colors.text.tertiary} /> : null}
    </Pressable>
  );
}

const styles = themed((c) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: 60, paddingVertical: spacing[2] },
  border: { borderBottomWidth: 1, borderBottomColor: c.border.default },
  pressed: { opacity: 0.7 },
  icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: c.brand.primary, alignItems: 'center', justifyContent: 'center' },
}));
