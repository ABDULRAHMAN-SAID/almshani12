import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import type { TeacherCard as TeacherCardData } from '@manassah/shared';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Badge, VerifiedBadge } from './Badge';
import { Rating } from './Rating';
import { Price } from './Price';
import { Chip } from './Chip';
import { Button } from './Button';
import { relativeDay, formatTime } from '@/lib/format';

export interface TeacherCardProps {
  teacher: TeacherCardData;
  onPress: () => void;
  onBook?: () => void;
  /** بطاقة مضغوطة للقوائم الأفقية */
  compact?: boolean;
  width?: number;
}

/** صورة حقيقية، معتمد، المادة، الخبرة، التقييم، الطلاب، السعر يبدأ من، أقرب موعد — لا أكثر */
export function TeacherCard({ teacher, onPress, onBook, compact, width }: TeacherCardProps) {
  const { t } = useTranslation();
  const subjects = teacher.subjects.slice(0, compact ? 2 : 3);

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={teacher.name}
      style={({ pressed }) => [styles.card, width ? { width } : null, pressed && styles.pressed]}>
      <View style={styles.top}>
        <Avatar name={teacher.name} url={teacher.avatarUrl} size={compact ? 'md' : 'lg'} verified={teacher.verified} />
        <View style={styles.head}>
          <View style={styles.nameRow}>
            <Text role="bodyMedium" numberOfLines={1} style={styles.name}>{teacher.name}</Text>
            {teacher.availableNow ? <Badge label={t('teachers.availableNow')} tone="success" /> : null}
          </View>
          {teacher.headline && !compact ? <Text role="caption" tone="secondary" numberOfLines={1}>{teacher.headline}</Text> : null}
          <View style={styles.statRow}>
            {teacher.ratingCount > 0 ? <Rating value={teacher.ratingAvg} count={teacher.ratingCount} size={12} /> : null}
            {teacher.yearsExp > 0 ? <Text role="caption" tone="tertiary" tabular>{t('teachers.experience', { n: teacher.yearsExp })}</Text> : null}
          </View>
        </View>
      </View>

      <View style={styles.chips}>
        {subjects.map(s => {
          const sc = subjectColors[(s.colorKey as SubjectColorKey) ?? 'default'] ?? subjectColors.default;
          return <Chip key={s.id} label={s.name} color={sc.main} softColor={sc.soft} small />;
        })}
        {teacher.verified ? <VerifiedBadge label={t('common.verified')} /> : null}
      </View>

      <View style={styles.foot}>
        <View style={styles.footInfo}>
          <Price value={teacher.priceFrom} from size="sm" />
          {teacher.nextSlotAt ? (
            <Text role="caption" tone="secondary" tabular numberOfLines={1}>
              {t('teachers.nextSlot')}: {relativeDay(teacher.nextSlotAt)} {formatTime(teacher.nextSlotAt)}
            </Text>
          ) : null}
          {teacher.studentsCount > 0 ? <Text role="caption" tone="tertiary" tabular>{teacher.studentsCount} {t('common.students')}</Text> : null}
        </View>
        {onBook ? <Button label={t('teachers.book')} onPress={onBook} size="sm" /> : <Button label={t('teachers.viewProfile')} onPress={onPress} size="sm" variant="secondary" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.default, padding: spacing[3], gap: spacing[3] },
  pressed: { opacity: 0.92 },
  top: { flexDirection: 'row', gap: spacing[3], alignItems: 'center' },
  head: { flex: 1, gap: 2, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  name: { flexShrink: 1 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flexWrap: 'wrap' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  foot: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing[2], borderTopWidth: 1, borderTopColor: colors.border.default, paddingTop: spacing[3] },
  footInfo: { flex: 1, gap: 2, minWidth: 0 },
});
