import { ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing, themed } from '@manassah/tokens';
import { useLearners } from '@/state/auth';
import { Text } from './Text';
import { LearnerAvatar } from './LearnerAvatar';

export interface LearnerPickerProps {
  value: number | null;
  onChange: (id: number) => void;
}

/** صفّ أفقي من شرائح المتعلّمين (صورة + اسم) لاختيار «لمن الحصة؟» — لا يُرسم عندما يقلّ المتعلّمون عن اثنين */
export function LearnerPicker({ value, onChange }: LearnerPickerProps) {
  const learners = useLearners();
  if (learners.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {learners.map(l => {
        const on = l.id === value;
        return (
          <Pressable key={l.id} onPress={() => onChange(l.id)} accessibilityRole="button" accessibilityState={{ selected: on }} style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}>
            <LearnerAvatar learner={l} size={28} badge={false} />
            <Text role="caption" color={on ? colors.text.inverse : colors.text.primary} numberOfLines={1} style={styles.label}>{l.displayName}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = themed((c) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing[2], paddingVertical: spacing[1] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], height: 44, paddingStart: spacing[2], paddingEnd: spacing[4], borderRadius: radius.full, borderWidth: 1.5, borderColor: c.border.strong, backgroundColor: c.bg.card },
  chipOn: { backgroundColor: c.bg.inverse, borderColor: c.bg.inverse },   // كما في Chip: inverse يبقى مقروءاً في الوضع الداكن
  pressed: { opacity: 0.8 },
  label: { fontSize: 14, lineHeight: 20, maxWidth: 140 },
}));
