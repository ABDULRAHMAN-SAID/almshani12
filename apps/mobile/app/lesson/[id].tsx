import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, subjectColors, type SubjectColorKey, themed } from '@manassah/tokens';
import { Screen, Text, Icon, Button, Badge, Avatar, Card, Dialog, Calendar, TimeSlotGrid, BottomSheet, SectionHeader } from '@/ui';
import { useBooking, useCancelBooking, useReschedule, useAvailability, useEndLesson, useStartConversation, useReport } from '@/features/queries';
import { useAuth } from '@/state/auth';
import { errorMessageKey, api } from '@/api/client';
import { formatDateTime, formatTime, relativeDay, money, dayKey, durationLabel } from '@/lib/format';
import { useCountdown } from '@/lib/hooks';

const TONE = { pending_payment: 'warning', confirmed: 'info', in_progress: 'live', completed: 'success', cancelled_by_student: 'neutral', cancelled_by_teacher: 'danger', no_show: 'danger', disputed: 'warning', expired: 'neutral' } as const;

/** تفاصيل الحصة: الحالة، الموعد، الطرف الآخر، الدخول، الإلغاء بسياسة واضحة، إعادة الجدولة، الملاحظات والواجب، الحضور */
export default function LessonDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id, booked } = useLocalSearchParams<{ id: string; booked?: string }>();
  const bookingId = Number(id);
  const user = useAuth(s => s.user);
  const q = useBooking(bookingId);
  const cancel = useCancelBooking(bookingId);
  const resched = useReschedule(bookingId);
  const end = useEndLesson(bookingId);
  const start = useStartConversation();
  const report = useReport();
  const [dialog, setDialog] = useState<null | 'cancel' | 'booked' | 'report'>(booked ? 'booked' : null);
  const [sheet, setSheet] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const b = q.data;
  const asTeacher = !!b && b.teacher.id === user?.id;
  const other = b ? (asTeacher ? b.student : b.teacher) : null;
  const sc = subjectColors[(b?.subject.colorKey as SubjectColorKey) ?? 'default'] ?? subjectColors.default;
  const avail = useAvailability(b?.teacher.id ?? 0, dayKey(new Date().toISOString()), b?.durationMinutes ?? 60);
  const secondsToOpen = useCountdown(b?.roomOpensAt);
  const live = b?.status === 'in_progress' || (b?.status === 'confirmed' && b.canJoin);

  const attachmentUrl = async (fileId: number) => { const r = await api.get<{ url: string }>(`/bookings/${bookingId}/notes/files/${fileId}`); return r.url; };

  return (
    <Screen onBack={() => router.back()} title={t('lessons.details')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} refreshing={q.isRefetching} onRefresh={() => q.refetch()}
      footer={b && (b.canJoin || live) ? <Button label={t('home.join')} icon="video" size="lg" full onPress={() => router.push(`/lesson/${bookingId}/precall`)} /> : undefined}>
      {b ? (
        <View style={styles.wrap}>
          <Card rail={sc.main}>
            <View style={styles.head}><Text role="h2" color={sc.main}>{b.subject.name}</Text><Badge label={t(`lessons.status.${b.status}`)} tone={TONE[b.status]} /></View>
            {b.learner ? <View style={styles.row}><Badge label={[b.learner.displayName, b.learner.gradeName].filter(Boolean).join(' · ')} tone="brand" icon="account" /></View> : null}
            <View style={styles.row}><Icon name="calendar" size={18} color={colors.text.secondary} /><Text role="body" tabular>{relativeDay(b.startsAt)} · {formatTime(b.startsAt)}–{formatTime(b.endsAt)}</Text></View>
            <View style={styles.row}><Icon name="clock" size={18} color={colors.text.secondary} /><Text role="body">{durationLabel(b.durationMinutes * 60)} · {t(`teachers.${b.mode}`)}</Text></View>
            <View style={styles.row}><Icon name="wallet" size={18} color={colors.text.secondary} /><Text role="body" tabular>{b.price > 0 ? money(b.price) : t('bookingUi.paidWithPackage')}</Text></View>
            {b.status === 'confirmed' && !b.canJoin ? <Text role="caption" tone="info" tabular>{t('lessons.precall.opensAt', { t: formatDateTime(b.roomOpensAt) })}{secondsToOpen > 0 && secondsToOpen < 3600 ? ` · ${t('live.openIn', { m: Math.ceil(secondsToOpen / 60) })}` : ''}</Text> : null}
          </Card>

          {other ? (
            <Card onPress={() => !asTeacher && router.push(`/teacher/${other.id}`)} style={styles.person}>
              <Avatar name={other.name} url={other.avatarUrl} size="lg" verified={other.verified} />
              <View style={styles.flex}><Text role="caption" tone="secondary">{asTeacher ? t('onboarding.student') : t('booking.teacher')}</Text><Text role="h3" numberOfLines={1}>{other.name}</Text></View>
              <Button label={t(asTeacher ? 'bookingUi.contactStudent' : 'bookingUi.contact')} variant="secondary" size="sm" icon="message" loading={start.isPending} onPress={() => start.mutate({ userId: other.id, context: { type: 'booking', id: bookingId } }, { onSuccess: c => router.push(`/conversation/${c.id}`) })} />
            </Card>
          ) : null}

          {b.notes ? (
            <Card accent>
              <SectionHeader title={t('lessons.post.summary')} />
              {b.notes.summary ? <Text role="body" tone="secondary" style={styles.para}>{b.notes.summary}</Text> : null}
              {b.notes.homework ? <View style={styles.hw}><Text role="caption" tone="brand">{t('lessons.post.homework')}</Text><Text role="body">{b.notes.homework}</Text></View> : null}
              {b.notes.attachments.length ? <View style={styles.att}>{b.notes.attachments.map((a, i) => <Button key={i} label={a.name} variant="secondary" size="sm" icon="attach" onPress={async () => { const u = await attachmentUrl(Number((a as { fileId?: number }).fileId ?? a.url)); if (typeof window !== 'undefined') window.open(u, '_blank'); }} />)}</View> : null}
            </Card>
          ) : null}

          {/* الحضور يُقرأ بعد انتهاء الحصة؛ أثناءها «جارية» لا شارتان حمراوان بصفر دقيقة */}
          {b.attendance && ['completed', 'no_show'].includes(b.status) ? (
            <Card>
              <SectionHeader title={t('lessons.room.participants')} />
              <View style={styles.att}>
                <Badge label={`${t('booking.teacher')}: ${Math.round(b.attendance.teacherSeconds / 60)} ${t('common.minutes')}`} tone={b.attendance.teacherSeconds ? 'success' : 'danger'} />
                <Badge label={`${t('onboarding.student')}: ${Math.round(b.attendance.studentSeconds / 60)} ${t('common.minutes')}`} tone={b.attendance.studentSeconds ? 'success' : 'danger'} />
              </View>
            </Card>
          ) : b.attendance && b.status === 'in_progress' ? (
            <Card>
              <SectionHeader title={t('lessons.room.participants')} />
              <View style={styles.att}><Badge label={t('bookingUi.inProgress')} tone="live" icon="video" /></View>
            </Card>
          ) : null}

          <View style={styles.actions}>
            {b.needsReview ? <Button label={t('lessons.post.rate')} icon="star" onPress={() => router.push(`/lesson/${bookingId}/review`)} full /> : null}
            {asTeacher && ['completed', 'in_progress', 'confirmed'].includes(b.status) && new Date(b.startsAt).getTime() < Date.now() ? <Button label={t('teacherUi.notes')} icon="document" variant="secondary" onPress={() => router.push(`/lesson/${bookingId}/notes`)} full /> : null}
            {asTeacher && live ? <Button label={t('live.endLesson')} icon="end" variant="danger" loading={end.isPending} onPress={() => end.mutate()} full /> : null}
            {b.status === 'completed' && !asTeacher ? <Button label={t('lessons.post.bookAgain')} icon="calendar" variant="secondary" onPress={() => router.push(`/teacher/${b.teacher.id}/book`)} full /> : null}
            {b.status === 'pending_payment' && !asTeacher ? <Button label={t('booking.pay')} icon="wallet" onPress={() => router.push({ pathname: '/checkout', params: { bookingId: String(bookingId) } })} full /> : null}
            {b.canReschedule && !asTeacher ? <Button label={t('booking.reschedule')} icon="refresh" variant="secondary" onPress={() => setSheet(true)} full /> : null}
            {b.canCancel ? <Button label={t('booking.cancel')} icon="close" variant="ghost" onPress={() => setDialog('cancel')} full /> : null}
            {['completed', 'no_show', 'in_progress'].includes(b.status) ? <Button label={t('bookingUi.report')} icon="warning" variant="ghost" size="sm" onPress={() => setDialog('report')} /> : null}
          </View>
          {b.canCancel ? <View style={styles.policy}><Icon name="info" size={16} color={colors.state.info} /><Text role="caption" tone="secondary" style={styles.flex}>{t('booking.refundIfCancel', { p: b.cancelRefundPercent })}</Text></View> : null}
        </View>
      ) : null}

      <Dialog visible={dialog === 'booked'} onClose={() => setDialog(null)} title={t('booking.confirmed')} body={t('booking.confirmedBody')} actions={<Button label={t('common.ok')} onPress={() => setDialog(null)} />} />
      <Dialog visible={dialog === 'cancel'} onClose={() => setDialog(null)} title={t('bookingUi.cancelConfirm')} body={t('bookingUi.cancelBody', { p: b?.cancelRefundPercent ?? 0 })}
        actions={<><Button label={t('bookingUi.keep')} variant="secondary" onPress={() => setDialog(null)} /><Button label={t('bookingUi.yesCancel')} variant="danger" loading={cancel.isPending} onPress={() => cancel.mutate(undefined, { onSuccess: () => setDialog(null) })} /></>}>
        {cancel.error ? <Text role="small" tone="danger">{t(errorMessageKey(cancel.error))}</Text> : null}
      </Dialog>
      <Dialog visible={dialog === 'report'} onClose={() => setDialog(null)} title={t('bookingUi.report')} body={report.isSuccess ? t('bookingUi.reportSent') : undefined}
        actions={report.isSuccess ? <Button label={t('common.ok')} onPress={() => setDialog(null)} /> : <><Button label={t('common.cancel')} variant="secondary" onPress={() => setDialog(null)} /><Button label={t('common.report')} loading={report.isPending} onPress={() => report.mutate({ targetType: 'user', targetId: other?.id ?? 0, reason: `${t('bookingUi.report')} #${bookingId}` })} /></>} />
      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title={t('booking.reschedule')}
        footer={<Button label={t('booking.reschedule')} full disabled={!slot} loading={resched.isPending} onPress={() => slot && resched.mutate(slot, { onSuccess: () => { setSheet(false); setSlot(null); } })} />}>
        <Text role="caption" tone="secondary">{t('bookingUi.rescheduleHint', { h: 24 })}</Text>
        {avail.data ? <View style={styles.cal}><Calendar days={avail.data} value={day} onChange={d => { setDay(d); setSlot(null); }} /><TimeSlotGrid slots={avail.data.find(d => d.date === day)?.slots ?? []} value={slot} onChange={setSlot} /></View> : null}
        {resched.error ? <Text role="small" tone="danger">{t(errorMessageKey(resched.error))}</Text> : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2], marginBottom: spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[2] },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  para: { lineHeight: 24 },
  hw: { marginTop: spacing[3], padding: spacing[3], backgroundColor: c.brand.primarySoft, borderRadius: radius.md, gap: 4 },
  att: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  actions: { gap: spacing[2], marginTop: spacing[2] },
  policy: { flexDirection: 'row', gap: spacing[2], alignItems: 'center' },
  cal: { gap: spacing[3], marginTop: spacing[3] },
}));
