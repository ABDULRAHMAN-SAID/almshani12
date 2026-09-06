import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import type { Booking } from '@manassah/shared';
import { Screen, Text, Tabs, Chip, Button, Card, Avatar, LessonCard, EmptyState, HeaderActions } from '@/ui';
import { useLessons } from '@/features/queries';
import { useAuth } from '@/state/auth';

type Tab = 'upcoming' | 'past' | 'packages';

/** الحصص: القادمة (اليوم/غداً/الأسبوع/لاحقاً) — السابقة — باقاتي */
export default function Lessons() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const canTeach = !!user?.roles.includes('teacher') && user.teacher?.verificationStatus === 'verified';
  const [asTeacher, setAsTeacher] = useState(false);
  const [tab, setTab] = useState<Tab>('upcoming');
  const feed = useLessons(asTeacher);
  const d = feed.data;
  const upcomingCount = d ? Object.values(d.upcoming).reduce((s, l) => s + l.length, 0) : 0;

  const card = (b: Booking) => (
    <LessonCard key={b.id} booking={b} asTeacher={asTeacher} onPress={() => router.push(`/lesson/${b.id}`)} onJoin={() => router.push(`/lesson/${b.id}/precall`)} />
  );
  const group = (key: string, list: Booking[]) => list.length ? (
    <View key={key} style={styles.group}>
      <Text role="h3" style={styles.groupTitle}>{t(`common.${key}`)}</Text>
      <View style={styles.list}>{list.map(card)}</View>
    </View>
  ) : null;

  return (
    <Screen title={t('lessons.title')} right={<HeaderActions />} loading={feed.isLoading} error={feed.error} onRetry={() => feed.refetch()}
      refreshing={feed.isRefetching} onRefresh={() => feed.refetch()} padded={false}>
      {canTeach ? (
        <View style={styles.roleRow}>
          <Chip label={t('onboarding.student')} selected={!asTeacher} onPress={() => setAsTeacher(false)} />
          <Chip label={t('onboarding.teacher')} selected={asTeacher} onPress={() => setAsTeacher(true)} icon="teacher" />
        </View>
      ) : null}
      <View style={styles.px}>
        <Tabs value={tab} onChange={setTab} items={[
          { key: 'upcoming', label: t('lessons.upcoming'), count: upcomingCount || undefined },
          { key: 'past', label: t('lessons.past') },
          ...(asTeacher ? [] : [{ key: 'packages' as Tab, label: t('lessons.packages'), count: d?.packages.length || undefined }]),
        ]} />
      </View>

      {tab === 'upcoming' ? (
        upcomingCount === 0
          ? <EmptyState icon="video" title={t('lessons.noUpcoming')} body={t('home.noLessonHint')} actionLabel={t('lessons.bookTeacher')} onAction={() => router.push('/teachers')} />
          : <View style={styles.px}>{(['today', 'tomorrow', 'thisWeek', 'later'] as const).map(k => group(k, d!.upcoming[k]))}</View>
      ) : null}

      {tab === 'past' ? (
        !d?.past.length
          ? <EmptyState icon="calendar" title={t('lessons.noPast')} />
          : <View style={[styles.px, styles.list, styles.pt]}>
            {d.past.map(b => (
              <View key={b.id}>
                {card(b)}
                {b.needsReview ? <Button label={t('lessons.post.rate')} icon="star" variant="ghost" size="sm" onPress={() => router.push(`/lesson/${b.id}/review`)} style={styles.rate} /> : null}
              </View>
            ))}
          </View>
      ) : null}

      {tab === 'packages' ? (
        !d?.packages.length
          ? <EmptyState icon="receipt" title={t('lessons.noPackages')} body={t('teachers.save', { p: 20 })} actionLabel={t('teachers.find')} onAction={() => router.push('/teachers')} />
          : <View style={[styles.px, styles.list, styles.pt]}>
            {d.packages.map(p => (
              <Card key={p.id} rail={colors.brand.gold}>
                <View style={styles.pkgHead}>
                  <Avatar name={p.teacher.name} url={p.teacher.avatarUrl} size="md" verified={p.teacher.verified} />
                  <View style={styles.flex}>
                    <Text role="bodyMedium">{p.teacher.name}</Text>
                    <Text role="caption" tone="secondary">{t('teachers.lessonsN', { n: p.lessonsCount })} · {p.durationMinutes} {t('common.minutes')} · {t(`teachers.${p.mode}`)}</Text>
                  </View>
                </View>
                <View style={styles.track}><View style={[styles.fill, { width: `${Math.round((p.remaining / p.lessonsCount) * 100)}%` }]} /></View>
                <View style={styles.pkgFoot}>
                  <Text role="small" tabular>{t('lessons.remainingLessons', { n: p.remaining })}</Text>
                  <Button label={t('booking.usePackage')} size="sm" onPress={() => router.push({ pathname: `/teacher/${p.teacher.id}/book`, params: { pkg: String(p.id) } })} />
                </View>
              </Card>
            ))}
          </View>
      ) : null}
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  px: { paddingHorizontal: spacing[4] },
  pt: { paddingTop: spacing[4] },
  roleRow: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  group: { paddingTop: spacing[4] },
  groupTitle: { marginBottom: spacing[2] },
  list: { gap: spacing[3] },
  rate: { alignSelf: 'flex-end' },
  pkgHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  track: { height: 8, borderRadius: 4, backgroundColor: c.bg.subtle, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: c.brand.gold, borderRadius: radius.full },
  pkgFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing[3] },
}));
