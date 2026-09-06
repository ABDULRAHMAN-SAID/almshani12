import type { ReactNode } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, hitTarget } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export interface ListRowProps {
  icon?: IconName;
  label: string;
  value?: string | null;
  badge?: number;
  onPress?: () => void;
  danger?: boolean;
  right?: ReactNode;
  last?: boolean;
}

/** صفّ قائمة موحّد (حسابي، الإعدادات): أيقونة + عنوان + قيمة/شارة + سهم */
export function ListRow({ icon, label, value, badge, onPress, danger, right, last }: ListRowProps) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, !last && styles.border, pressed && styles.pressed]}>
      {icon ? <View style={styles.icon}><Icon name={icon} size={20} color={danger ? colors.state.danger : colors.text.secondary} /></View> : null}
      <Text role="body" tone={danger ? 'danger' : 'primary'} style={styles.label} numberOfLines={1}>{label}</Text>
      {value ? <Text role="small" tone="secondary" tabular numberOfLines={1}>{value}</Text> : null}
      {badge ? <View style={styles.badge}><Text role="caption" tone="inverse" tabular>{badge}</Text></View> : null}
      {right}
      {onPress && !right ? <Icon name="forward" size={18} color={colors.text.tertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: hitTarget + 8, paddingVertical: spacing[2] },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default },
  pressed: { opacity: 0.7 },
  icon: { width: 32, alignItems: 'center' },
  label: { flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.brand.primary, alignItems: 'center', justifyContent: 'center' },
});
