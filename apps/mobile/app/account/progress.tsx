import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, subjectColors, type SubjectColorKey, themed } from '@manassah/tokens';
import { Screen, Text, Card, Icon, EmptyState, SectionHeader, type IconName } from '@/ui';
import { useProgress } from '@/features/queries';

/** لوحة التقدّم — أرقام حقيقية فقط؛ إن لم يبدأ الطالب تظهر دعوة لا أصفار وهمية */
export default function Progress() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useProgress();
  const d = q.data;
  const nothing = d && !d.week.lessons && !d.week.quizzes && !d.week.learningMinutes && !d.bySubject.length;
  const tile = (icon: IconName, label: string, value: string) => (
    <Card key={label} style={styles.tile}><Icon name={icon} size={20} color={colors.brand.primary} /><Text role="h1" tabular>{value}</Text><Text role="caption" tone="secondary">{label}</Text></Card>
  );
  return (
    <Screen onBack={() => router.back()} title={t('progress.title')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
      {nothing ? <EmptyState icon="progress" title={t('progress.noData')} actionLabel={t('home.quick.quiz')} onAction={() => router.replace('/(tabs)')} /> : d ? (
        <View style={styles.wrap}>
          <SectionHeader title={t('progress.thisWeek')} />
          <View style={styles.grid}>
            {tile('video', t('progress.lessons'), String(d.week.lessons))}
            {tile('clock', t('progress.learningHours'), (d.week.learningMinutes / 60).toFixed(1))}
            {tile('quiz', t('progress.quizzes'), String(d.week.quizzes))}
            {tile('star', t('progress.avgScore'), d.week.avgScore == null ? '—' : `${d.week.avgScore}٪`)}
          </View>
          {d.bySubject.length ? (
            <View><SectionHeader title={t('progress.bySubject')} />
              <Card>{d.bySubject.map(s => { const sc = subjectColors[(s.colorKey as SubjectColorKey)] ?? subjectColors.default; return (
                <View key={s.subjectId} style={styles.bar}><Text role="body" style={styles.flex}>{s.name}</Text><View style={styles.track}><View style={[styles.fill, { width: `${s.percent}%`, backgroundColor: sc.main }]} /></View><Text role="caption" tabular>{s.percent}٪</Text></View>); })}</Card>
            </View>
          ) : null}
          {d.weakTopics.length ? (
            <View><SectionHeader title={t('progress.weak')} />
              <Card>{d.weakTopics.map(w => <View key={w.topic} style={styles.bar}><Icon name="warning" size={16} color={colors.state.warning} /><Text role="body" style={styles.flex}>{w.topic}</Text><Text role="caption" tone="secondary">{w.subjectName}</Text><Text role="caption" tabular tone="danger">{w.percent}٪</Text></View>)}</Card>
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[4], paddingTop: spacing[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  tile: { width: '47%', flexGrow: 1, gap: spacing[1] },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2] },
  flex: { flex: 1, minWidth: 0 },
  track: { width: 110, height: 6, borderRadius: radius.full, backgroundColor: c.bg.subtle, overflow: 'hidden' },
  fill: { height: '100%' },
}));
