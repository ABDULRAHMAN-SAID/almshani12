import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export type BadgeTone = 'neutral' | 'brand' | 'gold' | 'success' | 'info' | 'warning' | 'danger' | 'live';

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.bg.subtle, fg: colors.text.secondary },
  brand: { bg: colors.brand.primarySoft, fg: colors.brand.primaryDark },
  gold: { bg: colors.brand.goldSoft, fg: colors.brand.goldDark },
  success: { bg: colors.state.successSoft, fg: colors.brand.greenDark },
  info: { bg: colors.state.infoSoft, fg: colors.state.info },
  warning: { bg: colors.state.warningSoft, fg: '#B36A0E' },
  danger: { bg: colors.state.dangerSoft, fg: colors.state.danger },
  live: { bg: colors.state.live, fg: colors.text.onPrimary },
};

export interface BadgeProps { label: string; tone?: BadgeTone; icon?: IconName }

/** شارة حالة — حبّة صغيرة، الحالة بالشكل واللون معاً لا باللون وحده */
export function Badge({ label, tone = 'neutral', icon }: BadgeProps) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size={13} color={t.fg} /> : null}
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
    paddingHorizontal: spacing[3], height: 26, borderRadius: radius.full,
  },
});
