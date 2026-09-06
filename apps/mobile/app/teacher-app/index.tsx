import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import { Screen, Text, Icon, Button, Card, Badge, Avatar, BottomSheet, EmptyState, type IconName } from '@/ui';
import { useTeacherMe, useTeacherStudents } from '@/features/queries';
import { ApiError } from '@/api/client';
import { money, formatDayShort } from '@/lib/format';

/** لوحة المعلّم: حالة الاعتماد أولاً، ثم أرقام حقيقية، ثم الأدوات */
export default function TeacherDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useTeacherMe();
  const students = useTeacherStudents();
  const [showStudents, setShowStudents] = useState(false);
  const notApplied = q.error instanceof ApiError && q.error.status === 404;
  useEffect(() => { if (notApplied) router.replace('/teacher-app/apply'); }, [notApplied, router]);
  const d = q.data;
  const status = d?.verificationStatus;
  const verified = status === 'verified';
  const tile = (icon: IconName, label: string, value: string, onPress?: () => void) => <Card key={label} style={styles.tile} onPress={onPress}><Icon name={icon} size={18} color={colors.brand.primary} /><Text role="h2" tabular>{value}</Text><Text role="caption" tone="secondary">{label}</Text></Card>;

  return (
    <Screen onBack={() => router.back()} title={t('teacherApp.dashboard')} loading={q.isLoading} error={notApplied ? undefined : q.error} onRetry={() => q.refetch()} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {d ? (
        <View style={styles.wrap}>
          <Card accent={verified} rail={!verified ? colors.state.warning : undefined}>
            <View style={styles.statusRow}>
              <View style={styles.flex}><Text role="h3">{t(`teacherUi.status.${status}`)}</Text>
                <Text role="small" tone="secondary">{status === 'pending' || status === 'under_review' ? t('teachers.pendingBody') : status === 'rejected' ? `${t('teacherUi.rejectedReason')}: ${d.lastDecision?.reason ?? '—'}` : status === 'suspended' ? (d.lastDecision?.reason ?? '') : t('teacherUi.commissionNote', { p: 20 })}</Text></View>
              <Badge label={t(`teacherUi.status.${status}`)} tone={verified ? 'success' : status === 'rejected' || status === 'suspended' ? 'danger' : 'warning'} />
            </View>
            {status === 'rejected' ? <Button label={t('teacherUi.reapply')} variant="secondary" size="sm" onPress={() => router.push('/teacher-app/apply')} style={styles.mt} /> : null}
          </Card>
          <View style={styles.grid}>
            {tile('wallet', t('teacherApp.monthIncome'), money(d.monthIncome), () => router.push('/teacher-app/earnings'))}
            {tile('video', t('teacherApp.todayLessons'), String(d.todayLessons), () => router.push('/(tabs)/lessons'))}
            {tile('calendar', t('teacherApp.upcoming'), String(d.upcomingLessons), () => router.push('/(tabs)/lessons'))}
            {tile('people', t('teacherApp.students'), String(d.studentsCount), () => setShowStudents(true))}
            {tile('star', t('teacherApp.rating'), d.ratingAvg ? d.ratingAvg.toFixed(1) : '—')}
            {tile('receipt', t('teacherApp.balance'), money(d.availableBalance), () => router.push('/teacher-app/earnings'))}
            {tile('book', t('teacherApp.booksSold'), String(d.booksSold), () => router.push('/teacher-app/books'))}
            {tile('courses', t('teacherApp.coursesSold'), String(d.coursesSold))}
          </View>
          <View style={styles.actions}>
            <Button label={t('teacherApp.availability')} icon="calendar" variant="secondary" full disabled={!verified} onPress={() => router.push('/teacher-app/availability')} />
            <Button label={t('teacherApp.earnings')} icon="wallet" variant="secondary" full onPress={() => router.push('/teacher-app/earnings')} />
            <Button label={t('teacherApp.quick.uploadBook')} icon="upload" variant="secondary" full disabled={!verified} onPress={() => router.push('/teacher-app/books')} />
            <Button label={t('teacherUi.myLessons')} icon="video" variant="secondary" full onPress={() => router.push('/(tabs)/lessons')} />
          </View>
          {!verified ? <Text role="caption" tone="tertiary" center>{t('teachers.pending')}</Text> : null}
        </View>
      ) : null}
      <BottomSheet visible={showStudents} onClose={() => setShowStudents(false)} title={t('teacherUi.students')}>
        {students.data?.length ? students.data.map(s => <View key={s.id} style={styles.student}><Avatar name={s.name} size="sm" /><View style={styles.flex}><Text role="bodyMedium">{s.name}</Text><Text role="caption" tone="secondary">{s.gradeName ?? ''} · {s.lessons} {t('common.lessons')} · {formatDayShort(s.lastAt)}</Text></View></View>)
          : <EmptyState icon="people" title={t('teacherUi.noStudents')} />}
      </BottomSheet>
    </Screen>
  );
}
const styles = StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  mt: { marginTop: spacing[3] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  tile: { width: '47%', flexGrow: 1, gap: 2 },
  actions: { gap: spacing[2] },
  student: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default, borderRadius: radius.sm },
});
