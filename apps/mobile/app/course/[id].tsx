import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import { Screen, Text, Icon, Button, Chip, Badge, Avatar, Rating, Price, Card, SectionHeader, ReviewList, ReviewSheet, Expandable, VerifiedBadge } from '@/ui';
import { useCourse, useAddToCart, useCart, useToggleFavorite } from '@/features/queries';
import { durationLabel } from '@/lib/format';

/** صفحة الدورة: ما ستتعلّمه، المحتوى بالأقسام (معاينة/مقفل/مكتمل)، التقييمات — والشراء أو المتابعة في زرّ واحد */
export default function CourseDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = Number(id);
  const q = useCourse(courseId);
  const cart = useCart();
  const add = useAddToCart();
  const fav = useToggleFavorite();
  const [review, setReview] = useState(false);
  const c = q.data;
  const sc = subjectColors[(c?.subject.colorKey as SubjectColorKey) ?? 'default'] ?? subjectColors.default;
  const inCart = !!cart.data?.items.some(i => i.itemType === 'course' && i.itemId === courseId);
  const lessons = c?.sections.flatMap(s => s.lessons) ?? [];
  const nextLesson = lessons.find(l => !l.completed && !l.locked) ?? lessons[0];

  return (
    <Screen onBack={() => router.back()} title={c?.title ?? ''} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} padded={false}
      right={c ? <Pressable onPress={() => fav.mutate({ targetType: 'course', targetId: courseId })} style={styles.iconBtn} accessibilityRole="button"><Icon name={c.favorited ? 'heartFilled' : 'heart'} size={22} color={c.favorited ? colors.brand.primary : colors.text.primary} /></Pressable> : undefined}
      footer={c ? (c.enrolled ? <Button label={c.progressPercent ? t('courses.continue') : t('courses.start')} icon="play" size="lg" full disabled={!nextLesson} onPress={() => nextLesson && router.push(`/course/${courseId}/lesson/${nextLesson.id}`)} />
        : <View style={styles.footer}><View style={styles.flex}><Price value={c.price} size="lg" /><Text role="caption" tone="tertiary">{t('book.securePay')}</Text></View>
          {c.price > 0 ? <Button label={inCart ? t('book.inCart') : t('book.addToCart')} variant="secondary" icon="cart" disabled={inCart} loading={add.isPending} onPress={() => add.mutate({ itemType: 'course', itemId: courseId })} /> : null}
          <Button label={c.price > 0 ? t('courses.buy') : t('courses.start')} size="lg" onPress={() => c.price > 0 ? router.push({ pathname: '/checkout', params: { items: JSON.stringify([{ itemType: 'course', itemId: courseId }]) } }) : nextLesson && router.push(`/course/${courseId}/lesson/${nextLesson.id}`)} /></View>) : undefined}>
      {c ? (
        <View>
          <View style={[styles.cover, { backgroundColor: sc.soft }]}>
            {c.coverUrl ? <Image source={{ uri: c.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={styles.coverText}><Text role="caption" color={sc.main}>{c.subject.name} · {c.grade.name}</Text><Text role="h2" color={sc.main} numberOfLines={3}>{c.title}</Text></View>}
            <View style={styles.play}><Icon name="play" size={26} color={colors.text.inverse} /></View>
          </View>
          <View style={styles.px}>
            <Text role="h1" style={styles.title}>{c.title}</Text>
            <View style={styles.chips}><Chip small label={c.subject.name} color={sc.main} softColor={sc.soft} /><Chip small label={c.grade.name} /></View>
            <Pressable onPress={() => router.push(`/teacher/${c.teacher.id}`)} style={styles.author} accessibilityRole="button">
              <Avatar name={c.teacher.name} url={c.teacher.avatarUrl} size="sm" verified={c.teacher.verified} /><Text role="bodyMedium" style={styles.flex} numberOfLines={1}>{c.teacher.name}</Text>{c.teacher.verified ? <VerifiedBadge label={t('common.verified')} /> : null}
            </Pressable>
            <View style={styles.stats}>
              {c.ratingCount > 0 ? <Rating value={c.ratingAvg} count={c.ratingCount} size={14} /> : <Text role="caption" tone="tertiary">{t('common.reviews')}: 0</Text>}
              <Text role="caption" tone="tertiary" tabular>{t('courses.lessons', { n: c.lessonsCount })}</Text>
              <Text role="caption" tone="tertiary" tabular>{durationLabel(c.totalMinutes * 60)}</Text>
            </View>
            {c.enrolled && c.progressPercent != null ? <View style={styles.progress}><View style={styles.track}><View style={[styles.fill, { width: `${c.progressPercent}%` }]} /></View><Text role="caption" tone="secondary" tabular>{t('courses.progress', { p: c.progressPercent })}</Text></View> : null}
            {c.description ? <View style={styles.section}><SectionHeader title={t('book.description')} /><Expandable text={c.description} /></View> : null}
            {c.learnPoints.length ? <View style={styles.section}><SectionHeader title={t('courses.learn')} />{c.learnPoints.map((p, i) => <View key={i} style={styles.point}><Icon name="checkCircle" size={18} color={colors.state.success} /><Text role="body" style={styles.flex}>{p}</Text></View>)}</View> : null}
            {c.requirements.length ? <View style={styles.section}><SectionHeader title={t('courses.requirements')} />{c.requirements.map((p, i) => <View key={i} style={styles.point}><Icon name="info" size={18} color={colors.state.info} /><Text role="body" style={styles.flex}>{p}</Text></View>)}</View> : null}

            <View style={styles.section}>
              <SectionHeader title={t('courses.curriculum')} subtitle={t('courses.units', { n: c.sections.length })} />
              {c.sections.map((s, si) => (
                <Card key={s.id} padded={false} style={styles.sectionCard}>
                  <View style={styles.sectionHead}><Text role="bodyMedium" style={styles.flex}>{si + 1}. {s.title}</Text><Text role="caption" tone="tertiary" tabular>{t('courses.lessons', { n: s.lessons.length })}</Text></View>
                  {s.lessons.map((l, li) => (
                    <Pressable key={l.id} disabled={l.locked} onPress={() => router.push(`/course/${courseId}/lesson/${l.id}`)} style={[styles.lesson, li < s.lessons.length - 1 && styles.lessonBorder]} accessibilityRole="button">
                      <View style={[styles.lessonIcon, l.completed && styles.doneBg]}><Icon name={l.locked ? 'lock' : l.completed ? 'check' : l.kind === 'quiz' ? 'quiz' : l.kind === 'reading' ? 'reading' : 'play'} size={16} color={l.locked ? colors.text.tertiary : l.completed ? colors.state.success : colors.brand.primary} /></View>
                      <View style={styles.flex}><Text role="body" tone={l.locked ? 'tertiary' : 'primary'} numberOfLines={2}>{l.title}</Text><Text role="caption" tone="tertiary" tabular>{t(`playerUi.${l.kind === 'video' ? 'lessonOf' : l.kind}`, { i: li + 1, n: s.lessons.length })}{l.durationSeconds ? ` · ${durationLabel(l.durationSeconds)}` : ''}</Text></View>
                      {l.isPreview && !c.enrolled ? <Badge label={t('courses.preview')} tone="info" /> : l.locked ? <Badge label={t('courses.locked')} tone="neutral" icon="lock" /> : null}
                    </Pressable>
                  ))}
                </Card>
              ))}
            </View>
            <View style={[styles.section, styles.last]}>
              <SectionHeader title={t('book.reviews')} onSeeAll={c.canReview ? () => setReview(true) : undefined} seeAllLabel={t('book.writeReview')} />
              <ReviewList items={c.reviews} avg={c.ratingAvg} count={c.ratingCount} />
            </View>
          </View>
          <ReviewSheet visible={review} onClose={() => setReview(false)} targetType="course" targetId={courseId} onDone={() => q.refetch()} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  px: { paddingHorizontal: spacing[4] },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cover: { aspectRatio: 16 / 9, justifyContent: 'flex-end', padding: spacing[4] },
  coverText: { gap: spacing[1] },
  play: { position: 'absolute', top: '50%', start: '50%', marginTop: -26, marginStart: -26, width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(23,23,23,0.55)', alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: spacing[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[2] },
  author: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  stats: { flexDirection: 'row', gap: spacing[3], alignItems: 'center', marginTop: spacing[2], flexWrap: 'wrap' },
  progress: { marginTop: spacing[3], gap: 4 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.bg.subtle, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.state.success },
  section: { marginTop: spacing[6] },
  last: { marginBottom: spacing[6] },
  point: { flexDirection: 'row', gap: spacing[2], alignItems: 'flex-start', marginBottom: spacing[2] },
  sectionCard: { marginBottom: spacing[3] },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[3], backgroundColor: colors.bg.subtle, borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
  lessonBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default },
  lessonIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  doneBg: { backgroundColor: colors.state.successSoft },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
});
