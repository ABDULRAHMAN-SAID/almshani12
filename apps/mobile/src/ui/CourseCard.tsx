import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import type { CourseCard as CourseCardData } from '@manassah/shared';
import { Text } from './Text';
import { Rating } from './Rating';
import { Price } from './Price';
import { Icon } from './Icon';
import { durationLabel } from '@/lib/format';

export interface CourseCardProps { course: CourseCardData; onPress: () => void; width?: number }

export function CourseCard({ course, onPress, width }: CourseCardProps) {
  const { t } = useTranslation();
  const sc = subjectColors[(course.subject.colorKey as SubjectColorKey) ?? 'default'] ?? subjectColors.default;
  const progress = course.enrolled ? course.progressPercent ?? 0 : null;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={course.title}
      style={({ pressed }) => [styles.card, width ? { width } : styles.fluid, pressed && styles.pressed]}>
      {course.coverUrl ? (
        <Image source={{ uri: course.coverUrl }} style={styles.cover} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.cover, styles.coverFallback, { backgroundColor: sc.soft }]}>
          <View style={[styles.play, { backgroundColor: sc.main }]}><Icon name="play" size={18} color={colors.text.onPrimary} /></View>
          <Text role="caption" color={sc.main}>{course.subject.name} · {course.grade.name}</Text>
        </View>
      )}
      <View style={styles.body}>
        <Text role="bodyMedium" numberOfLines={2} style={styles.title}>{course.title}</Text>
        <Text role="caption" tone="secondary" numberOfLines={1}>{course.teacher.name}</Text>
        <Text role="caption" tone="tertiary" tabular numberOfLines={1}>
          {t('courses.lessons', { n: course.lessonsCount })} · {durationLabel(course.totalMinutes * 60)}
        </Text>
        {progress != null ? (
          <View style={styles.progressWrap}>
            <View style={styles.track}><View style={[styles.fill, { width: `${progress}%`, backgroundColor: sc.main }]} /></View>
            <Text role="caption" tone="secondary" tabular>{t('courses.progress', { p: Math.round(progress) })}</Text>
          </View>
        ) : (
          <View style={styles.foot}>
            {course.ratingCount > 0 ? <Rating value={course.ratingAvg} count={course.ratingCount} size={12} /> : <View />}
            <Price value={course.price} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.default, overflow: 'hidden' },
  fluid: { flex: 1 },
  pressed: { opacity: 0.9 },
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.bg.subtle },
  coverFallback: { alignItems: 'flex-start', justifyContent: 'flex-end', padding: spacing[3], gap: spacing[2] },
  play: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing[3], gap: 2 },
  title: { minHeight: 44 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[2] },
  progressWrap: { marginTop: spacing[2], gap: 4 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.bg.subtle, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
});
