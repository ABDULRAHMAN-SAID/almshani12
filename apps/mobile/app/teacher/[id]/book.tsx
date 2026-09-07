import { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, subjectColors, type SubjectColorKey, themed } from '@manassah/tokens';
import type { LessonMode } from '@manassah/shared';
import { Screen, Text, Icon, Button, Chip, Badge, Avatar, Card, Input, Price, Calendar, TimeSlotGrid, SectionHeader, RowSkeleton, LearnerPicker } from '@/ui';
import { useTeacher, useAvailability, useCreateBooking, useLessons } from '@/features/queries';
import { useLearners, useActiveLearner } from '@/state/auth';
import { errorMessageKey } from '@/api/client';
import { dayKey, formatDateTime, money } from '@/lib/format';

type Duration = 30 | 45 | 60;

/** حجز حصة في شاشة واحدة: (١) المادة والنوع والمدة → (٢) اليوم والوقت → (٣) التأكيد — الدفع في الشاشة التالية */
export default function BookLesson() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id, pkg, day } = useLocalSearchParams<{ id: string; pkg?: string; day?: string }>();
  const teacherId = Number(id);
  const teacher = useTeacher(teacherId);
  const lessons = useLessons(false);
  const create = useCreateBooking();
  const p = teacher.data;
  // لمن الحصة؟ المتعلّم النشط افتراضياً — وليّ الأمر يبدّل من الصفّ العلوي
  const learners = useLearners();
  const active = useActiveLearner();
  const [learnerId, setLearnerId] = useState<number | null>(active?.id ?? null);
  const learner = learners.find(l => l.id === learnerId) ?? active;
  // باقة بلا متعلّم = لأي متعلّم؛ وإلا يجب أن تطابق المتعلّم المختار
  const myPackages = useMemo(() => (lessons.data?.packages ?? []).filter(x => x.teacher.id === teacherId && x.remaining > 0 && (x.learnerId == null || x.learnerId === learnerId)), [lessons.data, teacherId, learnerId]);
  const [packageId, setPackageId] = useState<number | null>(pkg ? Number(pkg) : null);
  const activePkg = myPackages.find(x => x.id === packageId) ?? null;
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [mode, setMode] = useState<LessonMode>('individual');
  const [duration, setDuration] = useState<Duration>(60);
  const [selectedDay, setSelectedDay] = useState<string | null>(day ?? null);
  const [slot, setSlot] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // المادة الافتراضية: أول مادة من مواد المتعلّم عند المعلّم، وإلا الأولى
  useEffect(() => { if (p && subjectId == null) setSubjectId((p.subjects.find(s => learner?.subjectIds.includes(s.id)) ?? p.subjects[0])?.id ?? null); }, [p, subjectId, learner]);
  useEffect(() => { if (activePkg) { setMode(activePkg.mode); setDuration(activePkg.durationMinutes as Duration); } }, [activePkg]);
  const from = dayKey(new Date().toISOString());
  const avail = useAvailability(teacherId, from, duration);
  useEffect(() => { if (avail.data && !selectedDay) { const first = avail.data.find(d => d.slots.some(s => s.available)); if (first) setSelectedDay(first.date); } }, [avail.data, selectedDay]);
  const daySlots = avail.data?.find(d => d.date === selectedDay)?.slots ?? [];
  const priceFor = (d: Duration, m: LessonMode) => p?.prices.find(x => x.durationMinutes === d && x.mode === m)?.price;
  const price = activePkg ? 0 : priceFor(duration, mode);
  const modes = useMemo(() => Array.from(new Set(p?.prices.map(x => x.mode) ?? [])), [p]);
  const canConfirm = !!subjectId && !!slot && (price != null);
  const lateSlot = !!slot && new Date(slot).getTime() - Date.now() < 24 * 3_600_000;

  const confirm = () => {
    if (!canConfirm || !slot || !subjectId) return;
    create.mutate({ teacherId, subjectId, mode, durationMinutes: duration, startsAt: slot, packagePurchaseId: activePkg?.id ?? null, note: note.trim() || null, learnerId: learnerId ?? undefined }, {
      onSuccess: r => {
        if (r.paymentRequired) router.replace({ pathname: '/checkout', params: { bookingId: String(r.booking.id), orderNumber: r.orderNumber ?? '', expiresAt: r.expiresAt ?? '' } });
        else router.replace({ pathname: `/lesson/${r.booking.id}`, params: { booked: '1' } });
      },
      onError: () => { avail.refetch(); setSlot(null); },
    });
  };

  return (
    <Screen onBack={() => router.back()} title={t('booking.title')} loading={teacher.isLoading} error={teacher.error} onRetry={() => teacher.refetch()}
      footer={p ? (
        <View style={styles.footer}>
          <View style={styles.flex}>
            {activePkg ? <Badge label={t('bookingUi.paidWithPackage')} tone="gold" /> : price != null ? <Price value={price} size="lg" /> : <Text role="small" tone="tertiary">—</Text>}
            {slot ? <Text role="caption" tone="secondary" tabular numberOfLines={1}>{formatDateTime(slot)}</Text> : <Text role="caption" tone="tertiary">{t('bookingUi.chooseSlot')}</Text>}
            {learners.length > 1 && learner ? <Text role="caption" tone="brand" numberOfLines={1}>{t('learners.bookFor')} {learner.displayName}</Text> : null}
            {/* داخل نافذة الـ٢٤ ساعة الإلغاء بلا استرجاع — يُقال قبل الدفع لا بعده */}
            {lateSlot ? <Text role="caption" tone="warning" numberOfLines={2}>{t('bookingUi.lateCancelWarning')}</Text> : null}
          </View>
          <Button label={activePkg ? t('bookingUi.confirmBooking') : t('bookingUi.payToConfirm')} size="lg" onPress={confirm} loading={create.isPending} disabled={!canConfirm} />
        </View>
      ) : undefined}>
      {p ? (
        <View style={styles.wrap}>
          <Card style={styles.teacher}>
            <Avatar name={p.name} url={p.avatarUrl} size="md" verified={p.verified} />
            <View style={styles.flex}><Text role="bodyMedium" numberOfLines={1}>{p.name}</Text>{p.headline ? <Text role="caption" tone="secondary" numberOfLines={1}>{p.headline}</Text> : null}</View>
          </Card>
          <LearnerPicker value={learnerId} onChange={id => { setLearnerId(id); setPackageId(null); setSubjectId(null); }} />

          {myPackages.length ? (
            <View>
              <SectionHeader title={t('bookingUi.packageOwned')} />
              <View style={styles.chips}>
                <Chip label={t('booking.pay')} selected={!activePkg} onPress={() => setPackageId(null)} />
                {myPackages.map(x => <Chip key={x.id} label={`${t('booking.usePackage')} · ${t('booking.remaining', { n: x.remaining })}`} icon="receipt" selected={packageId === x.id} onPress={() => setPackageId(x.id)} />)}
              </View>
            </View>
          ) : null}

          {/* ١ */}
          <View>
            <SectionHeader title={`١ · ${t('booking.chooseType')}`} />
            <Text role="caption" tone="secondary" style={styles.label}>{t('bookingUi.selectSubject')}</Text>
            <View style={styles.chips}>{p.subjects.map(s => { const sc = subjectColors[(s.colorKey as SubjectColorKey)] ?? subjectColors.default; const on = subjectId === s.id; return <Chip key={s.id} label={s.name} selected={on} color={on ? sc.main : undefined} softColor={on ? sc.soft : undefined} onPress={() => setSubjectId(s.id)} />; })}</View>
            {modes.length > 1 ? (
              <View>
                <Text role="caption" tone="secondary" style={styles.label}>{t('booking.mode')}</Text>
                <View style={styles.chips}>{modes.map(m => <Chip key={m} label={`${t(`teachers.${m}`)} — ${t(m === 'group' ? 'bookingUi.groupHint' : 'bookingUi.individualHint')}`} icon={m === 'group' ? 'people' : 'teacher'} selected={mode === m} onPress={() => !activePkg && setMode(m)} />)}</View>
              </View>
            ) : null}
            <Text role="caption" tone="secondary" style={styles.label}>{t('bookingUi.pickDuration')}</Text>
            <View style={styles.durations}>{([30, 45, 60] as Duration[]).filter(d => priceFor(d, mode) != null).map(d => (
              <Chip key={d} label={`${d} ${t('common.minutes')} · ${money(priceFor(d, mode)!)}`} selected={duration === d} onPress={() => { if (!activePkg) { setDuration(d); setSlot(null); } }} />
            ))}</View>
          </View>

          {/* ٢ */}
          <View>
            <SectionHeader title={`٢ · ${t('booking.chooseDate')}`} subtitle={t('common.timezoneNote')} />
            {avail.isLoading ? <RowSkeleton /> : avail.data ? (
              <View style={styles.cal}>
                <Calendar days={avail.data} timeOff={p.timeOff} value={selectedDay} onChange={d => { setSelectedDay(d); setSlot(null); }} />
                <Text role="caption" tone="secondary" style={styles.label}>{t('booking.chooseTime')}</Text>
                <TimeSlotGrid slots={daySlots} value={slot} onChange={setSlot} />
              </View>
            ) : <Text role="small" tone="danger">{t(errorMessageKey(avail.error))}</Text>}
          </View>

          {/* ٣ */}
          <View>
            <SectionHeader title={`٣ · ${t('booking.review')}`} />
            <Input value={note} onChangeText={setNote} placeholder={t('bookingUi.notePlaceholder')} label={t('booking.addNote')} multiline maxLength={300} />
            <View style={styles.policy}><Icon name="info" size={16} color={colors.state.info} /><Text role="caption" tone="secondary" style={styles.flex}>{t('bookingUi.policyNote', { h: 24 })} · {t('bookingUi.holdNote', { m: 10 })}</Text></View>
            {create.error ? <Text role="small" tone="danger" style={styles.err}>{t(errorMessageKey(create.error))}</Text> : null}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[5], paddingTop: spacing[2] },
  teacher: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  label: { marginTop: spacing[3], marginBottom: spacing[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  durations: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  cal: { gap: spacing[2] },
  policy: { flexDirection: 'row', gap: spacing[2], alignItems: 'flex-start', marginTop: spacing[3], padding: spacing[3], backgroundColor: c.state.infoSoft, borderRadius: radius.md },
  err: { marginTop: spacing[2] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
}));
