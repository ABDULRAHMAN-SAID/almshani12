import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, hitTarget } from '@manassah/tokens';
import type { TimeSlot as TimeSlotData } from '@manassah/shared';
import { Text } from './Text';
import { formatTime } from '@/lib/format';

export interface TimeSlotGridProps {
  slots: TimeSlotData[];
  value: string | null;   // startsAt ISO
  onChange: (startsAt: string) => void;
}

/** شبكة أوقات — المتاح فقط قابل للضغط، بتوقيت مسقط */
export function TimeSlotGrid({ slots, value, onChange }: TimeSlotGridProps) {
  const { t } = useTranslation();
  const available = slots.filter(s => s.available);
  if (available.length === 0) {
    return <Text role="small" tone="secondary" center style={styles.empty}>{t('booking.noSlots')}</Text>;
  }
  return (
    <View>
      <View style={styles.grid}>
        {slots.map(slot => {
          const selected = slot.startsAt === value;
          return (
            <Pressable
              key={slot.startsAt}
              onPress={() => slot.available && onChange(slot.startsAt)}
              disabled={!slot.available}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: !slot.available }}
              style={[styles.slot, selected && styles.selected, !slot.available && styles.disabled]}
            >
              <Text role="number" tone={selected ? 'inverse' : slot.available ? 'primary' : 'tertiary'} tabular
                style={!slot.available && styles.strike}>
                {formatTime(slot.startsAt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text role="caption" tone="tertiary" center style={styles.tz}>{t('common.timezoneNote')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  slot: {
    minWidth: 92, height: hitTarget, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.strong, paddingHorizontal: spacing[3],
  },
  selected: { backgroundColor: colors.state.info, borderColor: colors.state.info },
  disabled: { backgroundColor: colors.bg.subtle, borderColor: colors.border.default },
  strike: { textDecorationLine: 'line-through' },
  empty: { paddingVertical: spacing[6] },
  tz: { marginTop: spacing[3] },
});
