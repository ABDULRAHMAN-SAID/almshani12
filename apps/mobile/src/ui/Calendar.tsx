import { useMemo } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors, radius, spacing, themed } from '@manassah/tokens';
import type { DayAvailability } from '@manassah/shared';
import { Text } from './Text';
import { weekdayShort, dayKey } from '@/lib/format';

export interface CalendarProps {
  /** أيام التوفّر كما يعيدها الخادم — اليوم بلا مواعيد يُعرض معطّلاً */
  days: DayAvailability[];
  value: string | null;      // مفتاح اليوم YYYY-MM-DD
  onChange: (dayKey: string) => void;
}

/** شريط أيام أفقي (١٤ يوماً) — اليوم بعدد مواعيده، والمعطّل واضح بالشكل لا باللون فقط */
export function Calendar({ days, value, onChange }: CalendarProps) {
  const items = useMemo(() => days.map(d => {
    const available = d.slots.filter(s => s.available).length;
    const iso = `${d.date}T12:00:00Z`;
    return { key: d.date, iso, available, dayNum: new Date(iso).getUTCDate() };
  }), [days]);

  const today = dayKey(new Date().toISOString());

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map(item => {
        const selected = item.key === value;
        const disabled = item.available === 0;
        return (
          <Pressable
            key={item.key}
            onPress={() => !disabled && onChange(item.key)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`${weekdayShort(item.iso)} ${item.dayNum}`}
            style={[styles.day, selected && styles.daySelected, disabled && styles.dayDisabled, item.key === today && !selected && styles.dayToday]}
          >
            <Text role="caption" tone={selected ? 'inverse' : 'secondary'}>{weekdayShort(item.iso)}</Text>
            <Text role="h3" tone={selected ? 'inverse' : disabled ? 'tertiary' : 'primary'} tabular>{item.dayNum}</Text>
            <View style={[styles.dot, { backgroundColor: disabled ? 'transparent' : selected ? colors.text.onPrimary : colors.state.success }]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = themed((c) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing[2], paddingVertical: spacing[1] },
  day: {
    width: 58, height: 76, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 2,
    backgroundColor: c.bg.card, borderWidth: 1, borderColor: c.border.default,
  },
  daySelected: { backgroundColor: c.brand.primary, borderColor: c.brand.primary },
  dayDisabled: { backgroundColor: c.bg.subtle, borderStyle: 'dashed' },
  dayToday: { borderColor: c.brand.gold },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
}));
