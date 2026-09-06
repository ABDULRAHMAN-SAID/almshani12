import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { colors, spacing, radius, shadow, subjectColors, themed } from '@manassah/tokens';
import type { z } from 'zod';
import type { ContinueItem } from '@manassah/shared';
import { Screen, Text, Icon, Button, Card, Avatar, SectionHeader, BookCard, TeacherCard, CourseCard, LessonCard, HeaderActions, LearnerSwitcher, type IconName } from '@/ui';
import { useHome, useQuickQuiz } from '@/features/queries';
import { useAuth, useActiveLearner, showSwitcher, isTeacher } from '@/state/auth';

const CARD_W = 176, TEACHER_W = 300, COURSE_W = 260;

/**
 * الرئيسية — قليلة العناصر ومرتّبة، بالترتيب الملزم:
 * ترويسة وبحث → حصّتك القادمة → أربع بلاطات كبيرة (احجز معلّماً / ملخّص / حلّ مسائل / اختبار) → أكمل دراستك → ملخّصات صفّك → الدورات → المعلّمون → عروض
 */
export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const home = useHome();
  const quick = useQuickQuiz();
  const d = home.data;
  const active = useActiveLearner();
  const switcher = showSwitcher(user);
  const noLearner = !!user && user.learners.length === 0 && !isTeacher(user);
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'home.greetingMorning' : 'home.greetingEvening', { name: d?.greeting.name || user?.displayName || '' });

  const tiles: { key: string; icon: IconName; label: string; bg: string; fg: string; onPress: () => void }[] = [
    { key: 'teacher', icon: 'schoolSolid', label: t('home.quick.bookTeacher'), bg: colors.brand.primarySoft, fg: colors.brand.primary, onPress: () => router.push('/teachers') },
    { key: 'summary', icon: 'bookSolid', label: t('home.quick.buySummary'), bg: subjectColors.math.soft, fg: subjectColors.math.main, onPress: () => router.push({ pathname: '/(tabs)/library', params: { type: 'summary' } }) },
    { key: 'solve', icon: 'calculator', label: t('home.quick.solve'), bg: subjectColors.chemistry.soft, fg: subjectColors.chemistry.main, onPress: () => router.push({ pathname: '/(tabs)/library', params: { type: 'solved_problems' } }) },
    { key: 'quiz', icon: 'sparkles', label: t('home.quick.quiz'), bg: colors.brand.goldSoft, fg: colors.brand.goldDark, onPress: () => quick.mutate(undefined, { onSuccess: r => router.push(`/quiz/${r.quizId}`) }) },
  ];

  const openContinue = (c: z.infer<typeof ContinueItem>) => router.push(c.type === 'book' ? `/book/${c.id}/read` : c.type === 'course' ? `/course/${c.id}` : `/quiz/${c.id}`);
  const contColor = (type: string) => type === 'book' ? subjectColors.math.main : type === 'course' ? colors.brand.green : colors.brand.goldDark;

  return (
    <Screen bare loading={home.isLoading} error={home.error} onRetry={() => home.refetch()} refreshing={home.isRefetching} onRefresh={() => home.refetch()} padded={false}>
      {/* الترويسة */}
      <View style={[styles.px, styles.header]}>
        {switcher ? <LearnerSwitcher /> : (
          <Pressable onPress={() => router.push('/(tabs)/account')} style={styles.who} accessibilityRole="button">
            <Avatar name={user?.displayName ?? ''} url={user?.avatarUrl} size="md" />
            <View style={styles.whoText}>
              <Text role="h3" numberOfLines={1}>{greeting}</Text>
              {d?.greeting.gradeName ? <Text role="caption" tone="secondary" numberOfLines={1}>{d.greeting.gradeName}</Text> : null}
            </View>
          </Pressable>
        )}
        <HeaderActions />
      </View>
      {switcher ? (
        <View style={[styles.px, styles.greetRow]}>
          <Text role="h3" numberOfLines={1}>{greeting}</Text>
          {active && !active.isSelf ? <Text role="caption" tone="secondary" numberOfLines={1}>{t('home.followingLearner', { name: active.displayName })}</Text> : null}
        </View>
      ) : null}
      <Pressable onPress={() => router.push('/search')} style={({ pressed }) => [styles.px, styles.search, pressed && styles.pressed]} accessibilityRole="search">
        <View style={styles.searchBox}>
          <Icon name="search" size={22} color={colors.text.tertiary} />
          <Text role="body" tone="tertiary" numberOfLines={1}>{t('home.searchPlaceholder')}</Text>
        </View>
      </Pressable>

      {/* حساب بلا متعلّم بعد — دعوة واضحة لإضافة أول متعلّم */}
      {noLearner ? (
        <View style={[styles.px, styles.section]}>
          <Card accent>
            <View style={styles.emptyLesson}>
              <View style={styles.emptyIcon}><Icon name="people" size={30} color={colors.brand.primary} /></View>
              <View style={styles.flex}>
                <Text role="h3">{t('learners.emptyTitle')}</Text>
                <Text role="small" tone="secondary">{t('learners.emptyBody')}</Text>
              </View>
            </View>
            <Button label={t('learners.add')} onPress={() => router.push('/account/learners/new')} icon="plus" full style={styles.mt} />
          </Card>
        </View>
      ) : null}

      {/* ١) حصّتك القادمة */}
      <View style={[styles.px, styles.section]}>
        <SectionHeader title={t('home.nextLesson')} onSeeAll={d?.nextLesson ? () => router.push('/(tabs)/lessons') : undefined} />
        {d?.nextLesson ? (
          <LessonCard booking={d.nextLesson} hero onPress={() => router.push(`/lesson/${d.nextLesson!.id}`)} onJoin={() => router.push(`/lesson/${d.nextLesson!.id}/precall`)} />
        ) : (
          <Card>
            <View style={styles.emptyLesson}>
              <View style={styles.emptyIcon}><Icon name="videoSolid" size={30} color={colors.brand.primary} /></View>
              <View style={styles.flex}>
                <Text role="h3">{t('home.noLesson')}</Text>
                <Text role="small" tone="secondary">{t('home.noLessonHint')}</Text>
              </View>
            </View>
            <Button label={t('home.quick.bookTeacher')} onPress={() => router.push('/teachers')} icon="schoolSolid" full style={styles.mt} />
          </Card>
        )}
      </View>

      {/* ٢) أربع بلاطات كبيرة — كل شيء يبدأ من هنا */}
      <View style={[styles.px, styles.section]}>
        <SectionHeader title={t('home.heroTitle')} />
        <View style={styles.tiles}>
          {tiles.map(a => (
            <Pressable key={a.key} onPress={a.onPress} style={({ pressed }) => [styles.tile, { backgroundColor: a.bg }, pressed && styles.pressed]} accessibilityRole="button">
              <View style={styles.tileIcon}><Icon name={a.icon} size={28} color={a.fg} /></View>
              <Text role="h3" color={a.fg} numberOfLines={1}>{a.label}</Text>
              <Icon name="forward" size={18} color={a.fg} />
            </Pressable>
          ))}
        </View>
      </View>

      {/* ٣) أكمل دراستك */}
      {d?.continueItems.length ? (
        <View style={styles.section}>
          <View style={styles.px}><SectionHeader title={t('home.continue')} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.continueItems.map(c => {
              const cc = contColor(c.type);
              return (
                <Pressable key={`${c.type}-${c.id}`} onPress={() => openContinue(c)} style={({ pressed }) => [styles.cont, pressed && styles.pressed]} accessibilityRole="button">
                  <View style={[styles.contIcon, { backgroundColor: `${cc}1F` }]}><Icon name={c.type === 'book' ? 'bookSolid' : c.type === 'course' ? 'playCircle' : 'sparkles'} size={22} color={cc} /></View>
                  <Text role="bodyMedium" numberOfLines={2} style={styles.contTitle}>{c.title}</Text>
                  {c.subtitle ? <Text role="caption" tone="secondary" numberOfLines={1}>{c.subtitle}</Text> : null}
                  <View style={styles.contFoot}>
                    <View style={styles.track}><View style={[styles.fill, { width: `${c.progressPercent}%`, backgroundColor: cc }]} /></View>
                    <Text role="caption" color={cc} tabular>{c.progressPercent}%</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* ٤) ملخّصات صفّك */}
      {d?.gradeSummaries.length ? (
        <View style={styles.section}>
          <View style={styles.px}><SectionHeader title={d.greeting.gradeName ? t('home.gradeSummaries', { grade: d.greeting.gradeName }) : t('home.diplomaSummaries')} onSeeAll={() => router.push({ pathname: '/(tabs)/library', params: { type: 'summary' } })} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.gradeSummaries.map(b => <BookCard key={b.id} book={b} width={CARD_W} onPress={() => router.push(`/book/${b.id}`)} />)}
          </ScrollView>
        </View>
      ) : null}

      {/* ٥) الدورات */}
      {d?.courses.length ? (
        <View style={styles.section}>
          <View style={styles.px}><SectionHeader title={t('home.featuredCourses')} onSeeAll={() => router.push('/(tabs)/courses')} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.courses.map(c => <CourseCard key={c.id} course={c} width={COURSE_W} onPress={() => router.push(`/course/${c.id}`)} />)}
          </ScrollView>
        </View>
      ) : null}

      {/* ٦) المعلّمون المميّزون */}
      {d?.recommendedTeachers.length ? (
        <View style={styles.section}>
          <View style={styles.px}><SectionHeader title={t('home.recommendedTeachers')} onSeeAll={() => router.push('/teachers')} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
            {d.recommendedTeachers.map(tc => <TeacherCard key={tc.id} teacher={tc} width={TEACHER_W} compact onPress={() => router.push(`/teacher/${tc.id}`)} onBook={() => router.push(`/teacher/${tc.id}/book`)} />)}
          </ScrollView>
        </View>
      ) : null}

      {/* ٧) عروض — بطاقة واحدة واضحة */}
      {d?.offers.length ? (
        <View style={[styles.px, styles.section]}>
          {d.offers.slice(0, 1).map(o => (
            <Card key={o.id} tint={colors.brand.goldSoft} style={styles.offer}>
              <View style={styles.offerIcon}><Icon name="gift" size={26} color={colors.brand.goldDark} /></View>
              <View style={styles.flex}>
                <Text role="h3" numberOfLines={1}>{o.title}</Text>
                {o.subtitle ? <Text role="small" tone="secondary" numberOfLines={2}>{o.subtitle}</Text> : null}
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

const styles = themed((c) => StyleSheet.create({
  px: { paddingHorizontal: spacing[4] },
  section: { paddingTop: spacing[5] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing[3], paddingBottom: spacing[3] },
  who: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1, minWidth: 0 },
  whoText: { flex: 1, minWidth: 0 },
  greetRow: { paddingBottom: spacing[3], gap: 2 },
  search: { paddingBottom: spacing[1] },
  searchBox: { height: 54, borderRadius: radius.full, backgroundColor: c.bg.card, borderWidth: 1.5, borderColor: c.border.default, flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[4], ...shadow.card },
  pressed: { opacity: 0.85 },
  emptyLesson: { flexDirection: 'row', gap: spacing[3], alignItems: 'center' },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: c.brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  mt: { marginTop: spacing[4] },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  tile: { width: '48%', flexGrow: 1, borderRadius: radius.lg, padding: spacing[3], gap: spacing[2], minHeight: 128, justifyContent: 'space-between' },
  tileIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.bg.card, alignItems: 'center', justifyContent: 'center' },
  hList: { paddingHorizontal: spacing[4], gap: spacing[3], paddingBottom: spacing[2] },
  cont: { width: 210, backgroundColor: c.bg.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border.default, padding: spacing[3], gap: spacing[1], ...shadow.card },
  contIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[1] },
  contTitle: { minHeight: 52 },
  contFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[1] },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.bg.subtle, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  offerIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.bg.card, alignItems: 'center', justifyContent: 'center' },
  bottom: { height: spacing[8] },
}));
