import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export type BadgeTone = 'neutral' | 'brand' | 'gold' | 'success' | 'info' | 'warning' | 'danger' | 'live';

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.bg.subtle, fg: colors.text.secondary },
  brand: { bg: colors.brand.primarySoft, fg: colors.brand.primaryDark },
  gold: { bg: colors.brand.goldSoft, fg: '#8A6A2E' },
  success: { bg: colors.state.successSoft, fg: colors.state.success },
  info: { bg: colors.state.infoSoft, fg: colors.state.info },
  warning: { bg: colors.state.warningSoft, fg: colors.state.warning },
  danger: { bg: colors.state.dangerSoft, fg: colors.state.danger },
  live: { bg: colors.state.danger, fg: colors.text.onPrimary },
};

export interface BadgeProps { label: string; tone?: BadgeTone; icon?: IconName }

/** شارة حالة صغيرة — الحالة بالشكل واللون معاً لا باللون وحده */
export function Badge({ label, tone = 'neutral', icon }: BadgeProps) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size={12} color={t.fg} /> : null}
      <Text role="caption" color={t.fg}>{label}</Text>
    </View>
  );
}

/** شارة «معتمد» — ذهبية، تُستخدم فقط عندما تكون الحالة verified فعلاً */
export function VerifiedBadge({ label = 'معتمد' }: { label?: string }) {
  return <Badge label={label} tone="gold" icon="verified" />;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    paddingHorizontal: spacing[2], height: 22, borderRadius: radius.sm,
  },
});
