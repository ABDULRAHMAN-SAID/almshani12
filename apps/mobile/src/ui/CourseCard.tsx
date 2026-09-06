import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, shadow, subjectColors, subjectIcons, type SubjectColorKey, themed } from '@manassah/tokens';
import type { CourseCard as CourseCardData } from '@manassah/shared';
import { Text } from './Text';
import { Rating } from './Rating';
import { Price } from './Price';
import { Icon } from './Icon';
import { durationLabel } from '@/lib/format';

export interface CourseCardProps { course: CourseCardData; onPress: () => void; width?: number }

export function CourseCard({ course, onPress, width }: CourseCardProps) {
  const { t } = useTranslation();
  const key = ((course.subject.colorKey && course.subject.colorKey in subjectColors ? course.subject.colorKey : 'default') as SubjectColorKey);
  const sc = subjectColors[key];
  const progress = course.enrolled ? course.progressPercent ?? 0 : null;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={course.title}
      style={({ pressed }) => [styles.card, width ? { width } : styles.fluid, pressed && styles.pressed]}>
      {course.coverUrl ? (
        <Image source={{ uri: course.coverUrl }} style={styles.cover} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.cover, styles.coverFallback, { backgroundColor: sc.main }]}>
          <Ionicons name={subjectIcons[key] as keyof typeof Ionicons.glyphMap} size={110} color="#FFFFFF" style={styles.watermark} />
          <View style={styles.play}><Icon name="play" size={26} color={sc.main} /></View>
          <View style={styles.pill}><Text role="caption" color={sc.main} numberOfLines={1}>{course.subject.name}</Text></View>
        </View>
      )}
      <View style={styles.body}>
        <Text role="h3" numberOfLines={2} style={styles.title}>{course.title}</Text>
        <Text role="small" tone="secondary" numberOfLines={1}>{course.teacher.name}</Text>
        <Text role="caption" tone="tertiary" tabular numberOfLines={1}>
          {t('courses.lessons', { n: course.lessonsCount })} · {durationLabel(course.totalMinutes * 60)}
        </Text>
        {progress != null ? (
          <View style={styles.progressWrap}>
            <View style={styles.track}><View style={[styles.fill, { width: `${progress}%`, backgroundColor: sc.main }]} /></View>
            <Text role="caption" color={sc.main} tabular>{t('courses.progress', { p: Math.round(progress) })}</Text>
          </View>
        ) : (
          <View style={styles.foot}>
            {course.ratingCount > 0 ? <Rating value={course.ratingAvg} count={course.ratingCount} size={13} /> : <View />}
            <Price value={course.price} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = themed((c) => StyleSheet.create({
  card: { backgroundColor: c.bg.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border.default, overflow: 'hidden', ...shadow.card },
  fluid: { flex: 1 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: c.bg.subtle },
  coverFallback: { alignItems: 'flex-start', justifyContent: 'space-between', padding: spacing[3], overflow: 'hidden' },
  watermark: { position: 'absolute', bottom: -30, start: -20, opacity: 0.2 },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingStart: 3 },
  pill: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: radius.full, paddingHorizontal: spacing[3], height: 26, justifyContent: 'center' },
  body: { padding: spacing[3], gap: 2 },
  title: { minHeight: 56 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[2] },
  progressWrap: { marginTop: spacing[2], gap: 6 },
  track: { height: 8, borderRadius: 4, backgroundColor: c.bg.subtle, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
}));
