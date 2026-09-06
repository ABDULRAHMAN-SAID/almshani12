import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, shadow, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import type { TeacherCard as TeacherCardData } from '@manassah/shared';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Badge } from './Badge';
import { Icon } from './Icon';
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

/** صورة كبيرة، الاسم، تقييم ذهبي، المواد بألوانها، السعر، وزر حجز كبير — لا أكثر */
export function TeacherCard({ teacher, onPress, onBook, compact, width }: TeacherCardProps) {
  const { t } = useTranslation();
  const subjects = teacher.subjects.slice(0, compact ? 2 : 3);

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={teacher.name}
      style={({ pressed }) => [styles.card, width ? { width } : null, pressed && styles.pressed]}>
      <View style={styles.top}>
        <Avatar name={teacher.name} url={teacher.avatarUrl} size="lg" verified={teacher.verified} />
        <View style={styles.head}>
          <Text role="h3" numberOfLines={1}>{teacher.name}</Text>
          {teacher.headline && !compact ? <Text role="small" tone="secondary" numberOfLines={1}>{teacher.headline}</Text> : null}
          <View style={styles.statRow}>
            {teacher.ratingCount > 0 ? (
              <View style={styles.ratingPill}>
                <Icon name="star" size={14} color={colors.brand.goldDark} />
                <Text role="caption" color={colors.brand.goldDark} tabular>{teacher.ratingAvg.toFixed(1)}</Text>
              </View>
            ) : null}
            {teacher.yearsExp > 0 ? <Text role="caption" tone="secondary" tabular>{t('teachers.experience', { n: teacher.yearsExp })}</Text> : null}
            {teacher.availableNow ? <Badge label={t('teachers.availableNow')} tone="success" /> : null}
          </View>
        </View>
      </View>

      <View style={styles.chips}>
        {subjects.map(s => {
          const sc = subjectColors[(s.colorKey as SubjectColorKey) ?? 'default'] ?? subjectColors.default;
          return <Chip key={s.id} label={s.name} color={sc.main} softColor={sc.soft} small />;
        })}
      </View>

      <View style={styles.foot}>
        <View style={styles.footInfo}>
          <Price value={teacher.priceFrom} from size={compact ? 'sm' : 'md'} />
          {teacher.nextSlotAt && !compact ? (
            <Text role="caption" tone="secondary" tabular numberOfLines={1}>
              {t('teachers.nextSlot')}: {relativeDay(teacher.nextSlotAt)} {formatTime(teacher.nextSlotAt)}
            </Text>
          ) : null}
        </View>
        {onBook ? <Button label={t('teachers.book')} onPress={onBook} icon="calendar" /> : <Button label={t('teachers.viewProfile')} onPress={onPress} variant="secondary" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border.default, padding: spacing[4], gap: spacing[3], ...shadow.card },
  pressed: { opacity: 0.92 },
  top: { flexDirection: 'row', gap: spacing[3], alignItems: 'center' },
  head: { flex: 1, gap: 4, minWidth: 0 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.brand.goldSoft, borderRadius: radius.full, paddingHorizontal: spacing[2], height: 26 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2], borderTopWidth: 1.5, borderTopColor: colors.border.default, paddingTop: spacing[3] },
  footInfo: { flex: 1, gap: 2, minWidth: 0 },
});
