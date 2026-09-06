import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing, type Colors } from '@manassah/tokens';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';

export type BadgeTone = 'neutral' | 'brand' | 'gold' | 'success' | 'info' | 'warning' | 'danger' | 'live';

/** تُحسب عند الرسم كي تتبع السِمة (فاتح/داكن) */
const tones = (c: Colors): Record<BadgeTone, { bg: string; fg: string }> => ({
  neutral: { bg: c.bg.subtle, fg: c.text.secondary },
  brand: { bg: c.brand.primarySoft, fg: c.brand.primary },
  gold: { bg: c.brand.goldSoft, fg: c.brand.goldDark },
  success: { bg: c.state.successSoft, fg: c.brand.green },
  info: { bg: c.state.infoSoft, fg: c.state.info },
  warning: { bg: c.state.warningSoft, fg: c.state.warningText },
  danger: { bg: c.state.dangerSoft, fg: c.state.danger },
  live: { bg: c.state.live, fg: c.text.onPrimary },
});

export interface BadgeProps { label: string; tone?: BadgeTone; icon?: IconName }

/** شارة حالة — حبّة صغيرة، الحالة بالشكل واللون معاً لا باللون وحده */
export function Badge({ label, tone = 'neutral', icon }: BadgeProps) {
  const t = tones(colors)[tone];
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
