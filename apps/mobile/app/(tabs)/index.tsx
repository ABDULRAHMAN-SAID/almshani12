import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { colors, spacing, radius } from '@manassah/tokens';
import type { z } from 'zod';
import type { ContinueItem } from '@manassah/shared';
import { Screen, Text, Icon, Button, Card, Avatar, SectionHeader, BookCard, TeacherCard, CourseCard, LessonCard, HeaderActions, type IconName } from '@/ui';
import { useHome, useQuickQuiz } from '@/features/queries';
import { useAuth } from '@/state/auth';

const CARD_W = 168, TEACHER_W = 290, COURSE_W = 250;

/**
 * الرئيسية — الترتيب ملزم:
 * ترويسة → بطل + إجراءات سريعة → حصّتك القادمة → أكمل دراستك → ملخّصات صفّك → الدورات → المعلّمون المميّزون → الأكثر طلباً → حلّ مسائل → عروض
 */
export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const home = useHome();
  const quick = useQuickQuiz();
  const d = home.data;
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'home.greetingMorning' : 'home.greetingEvening', { name: d?.greeting.name || user?.displayName || '' });

  const actions: { key: string; icon: IconName; label: string; onPress: () => void }[] = [
    { key: 'teacher', icon: 'teacher', label: t('home.quick.bookTeacher'), onPress: () => router.push('/teachers') },
    { key: 'summary', icon: 'book', label: t('home.quick.buySummary'), onPress: () => router.push({ pathname: '/(tabs)/library', params: { type: 'summary' } }) },
    { key: 'solve', icon: 'solve', label: t('home.quick.solve'), onPress: () => router.push({ pathname: '/(tabs)/library', params: { type: 'solved_problems' } }) },
    { key: 'courses', icon: 'courses', label: t('home.quick.courses'), onPress: () => router.push('/(tabs)/courses') },
    { key: 'quiz', icon: 'quiz', label: t('home.quick.quiz'), onPress: () => quick.mutate(undefined, { onSuccess: r => router.push(`/quiz/${r.quizId}`) }) },
  ];

  const openContinue = (c: z.infer<typeof ContinueItem>) => router.push(c.type === 'book' ? `/book/${c.id}/read` : c.type === 'course' ? `/course/${c.id}` : `/quiz/${c.id}`);

  return (
    <Screen bare loading={home.isLoading} error={home.error} onRetry={() => home.refetch()} refreshing={home.isRefetching} onRefresh={() => home.refetch()} padded={false}>
      {/* الترويسة */}
      <View style={[styles.px, styles.header]}>
        <Pressable onPress={() => router.push('/(tabs)/account')} style={styles.who} accessibilityRole="button">
          <Avatar name={user?.displayName ?? ''} url={user?.avatarUrl} size="md" />
          <View style={styles.whoText}>
            <Text role="bodyMedium" numberOfLines={1}>{greeting}</Text>
            {d?.greeting.gradeName ? <Text role="caption" tone="secondary" numberOfLines={1}>{d.greeting.gradeName}</Text> : null}
          </View>
        </Pressable>
        <HeaderActions />
      </View>
      <Pressable onPress={() => router.push('/search')} style={[styles.px, styles.search]} accessibilityRole="search">
        <View style={styles.searchBox}>
          <Icon name="search" size={20} color={colors.text.tertiary} />
          <Text role="body" tone="tertiary">{t('home.searchPlaceholder')}</Text>
        </View>
      </Pressable>

      {/* البطل + الإجراءات السريعة */}
      <View style={[styles.px, styles.hero]}>
        <Text role="display" style={styles.heroTitle}>{t('home.heroTitle')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
          {actions.map(a => (
            <Pressable key={a.key} onPress={a.onPress} style={({ pressed }) => [styles.quick, pressed && styles.pressed]} accessibilityRole="button">
              <View style={styles.quickIcon}><Icon name={a.icon} size={22} color={colors.brand.primary} /></View>
              <Text role="caption" center numberOfLines={2}>{a.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ١) حصّتك القادمة */}
      <View style={styles.px}>
        <SectionHeader title={t('home.nextLesson')} onSeeAll={d?.nextLesson ? () => router.push('/(tabs)/lessons') : undefined} />
        {d?.nextLesson ? (
          <LessonCard booking={d.nextLesson} hero onPress={() => router.push(`/lesson/${d.nextLesson!.id}`)} onJoin={() => router.push(`/lesson/${d.nextLesson!.id}/precall`)} />
        ) : (
          <Card accent>
            <View style={styles.emptyLesson}>
              <View style={styles.emptyIcon}><Icon name="video" size={26} color={colors.brand.primary} /></View>
              <View style={styles.flex}>
                <Text role="h3">{t('home.noLesson')}</Text>
                <Text role="small" tone="secondary">{t('home.noLessonHint')}</Text>
              </View>
            </View>
            <Button label={t('home.quick.bookTeacher')} onPress={() => router.push('/teachers')} icon="teacher" style={styles.mt} />
          </Card>
        )}
      </View>

      {/* ٢) أكمل دراستك */}
      {d?.continueItems.length ? (
        <View>
          <View style={styles.px}><SectionHeader title={t('home.continue')} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.continueItems.map(c => (
              <Pressable key={`${c.type}-${c.id}`} onPress={() => openContinue(c)} style={({ pressed }) => [styles.cont, pressed && styles.pressed]} accessibilityRole="button">
                <View style={styles.contIcon}><Icon name={c.type === 'book' ? 'book' : c.type === 'course' ? 'play' : 'quiz'} size={18} color={colors.state.info} /></View>
                <Text role="bodyMedium" numberOfLines={2} style={styles.contTitle}>{c.title}</Text>
                {c.subtitle ? <Text role="caption" tone="secondary" numberOfLines={1}>{c.subtitle}</Text> : null}
                <View style={styles.track}><View style={[styles.fill, { width: `${c.progressPercent}%` }]} /></View>
                <Text role="caption" tone="tertiary" tabular>{t('courses.progress', { p: c.progressPercent })}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* ٣) ملخّصات صفّك */}
      {d?.gradeSummaries.length ? (
        <View>
          <View style={styles.px}><SectionHeader title={d.greeting.gradeName ? t('home.gradeSummaries', { grade: d.greeting.gradeName }) : t('home.diplomaSummaries')} onSeeAll={() => router.push({ pathname: '/(tabs)/library', params: { type: 'summary' } })} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.gradeSummaries.map(b => <BookCard key={b.id} book={b} width={CARD_W} onPress={() => router.push(`/book/${b.id}`)} />)}
          </ScrollView>
        </View>
      ) : null}

      {/* ٤) الدورات */}
      {d?.courses.length ? (
        <View>
          <View style={styles.px}><SectionHeader title={t('home.featuredCourses')} onSeeAll={() => router.push('/(tabs)/courses')} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.courses.map(c => <CourseCard key={c.id} course={c} width={COURSE_W} onPress={() => router.push(`/course/${c.id}`)} />)}
          </ScrollView>
        </View>
      ) : null}

      {/* ٥) المعلّمون المميّزون */}
      {d?.recommendedTeachers.length ? (
        <View>
          <View style={styles.px}><SectionHeader title={t('home.recommendedTeachers')} onSeeAll={() => router.push('/teachers')} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.recommendedTeachers.map(tc => <TeacherCard key={tc.id} teacher={tc} width={TEACHER_W} compact onPress={() => router.push(`/teacher/${tc.id}`)} onBook={() => router.push(`/teacher/${tc.id}/book`)} />)}
          </ScrollView>
        </View>
      ) : null}

      {/* ٦) الأكثر طلباً */}
      {d?.trending.length ? (
        <View>
          <View style={styles.px}><SectionHeader title={t('home.trending')} onSeeAll={() => router.push('/(tabs)/library')} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.trending.map(b => <BookCard key={b.id} book={b} width={CARD_W} onPress={() => router.push(`/book/${b.id}`)} />)}
          </ScrollView>
        </View>
      ) : null}

      {/* ٧) حلّ مسائل خطوة بخطوة */}
      {d?.solvedProblems.length ? (
        <View>
          <View style={styles.px}><SectionHeader title={t('home.solvedProblems')} onSeeAll={() => router.push({ pathname: '/(tabs)/library', params: { type: 'solved_problems' } })} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.solvedProblems.map(b => <BookCard key={b.id} book={b} width={CARD_W} onPress={() => router.push(`/book/${b.id}`)} />)}
          </ScrollView>
        </View>
      ) : null}

      {/* ٨) عروض */}
      {d?.offers.length ? (
        <View style={styles.px}>
          <SectionHeader title={t('home.offers')} />
          {d.offers.map(o => (
            <Card key={o.id} style={styles.offer} accent>
              <View style={styles.flex}>
                <Text role="bodyMedium">{o.title}</Text>
                {o.subtitle ? <Text role="caption" tone="secondary">{o.subtitle}</Text> : null}
              </View>
              {o.code ? <Button label={o.code} variant="secondary" size="sm" icon="copy" onPress={() => Clipboard.setStringAsync(o.code!)} /> : null}
            </Card>
          ))}
        </View>
      ) : null}
      <View style={styles.bottom} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  px: { paddingHorizontal: spacing[4] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing[2], paddingBottom: spacing[2] },
  who: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1, minWidth: 0 },
  whoText: { flex: 1, minWidth: 0 },
  search: { paddingBottom: spacing[2] },
  searchBox: { height: 48, borderRadius: radius.md, backgroundColor: colors.bg.subtle, flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3] },
  hero: { paddingTop: spacing[3], paddingBottom: spacing[5], gap: spacing[4] },
  heroTitle: { lineHeight: 40 },
  quickRow: { flexDirection: 'row', gap: spacing[3] },
  quick: { width: 84, alignItems: 'center', gap: spacing[2] },
  quickIcon: { width: 60, height: 60, borderRadius: radius.lg, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
  emptyLesson: { flexDirection: 'row', gap: spacing[3], alignItems: 'center' },
  emptyIcon: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  mt: { marginTop: spacing[4] },
  hList: { paddingHorizontal: spacing[4], gap: spacing[3], paddingBottom: spacing[6] },
  cont: { width: 220, backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.default, padding: spacing[3], gap: spacing[1] },
  contIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.state.infoSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[1] },
  contTitle: { minHeight: 44 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.bg.subtle, overflow: 'hidden', marginTop: spacing[1] },
  fill: { height: '100%', backgroundColor: colors.state.info, borderRadius: 2 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[3] },
  bottom: { height: spacing[6] },
});
