import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, themed } from '@manassah/tokens';
import { Screen, Text, Button, Input, Chip, Card, SectionHeader, Icon } from '@/ui';
import { useTeacherAvailability, useSaveAvailability, useAddTimeOff, useRemoveTimeOff } from '@/features/queries';
import { errorMessageKey } from '@/api/client';
import { formatDateTime } from '@/lib/format';
import { safeBack } from '@/lib/session';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type Rule = { weekday: number; startTime: string; endTime: string; slotMinutes: number; breakMinutes: number };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** تقويم المعلّم: فترات أسبوعية متكرّرة (اليوم، من، إلى، خانة، استراحة) + إجازات — المواعيد تُولَّد منها تلقائياً */
export default function Availability() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useTeacherAvailability();
  const save = useSaveAvailability();
  const addOff = useAddTimeOff();
  const removeOff = useRemoveTimeOff();
  const [rules, setRules] = useState<Rule[]>([]);
  const [off, setOff] = useState({ date: '', from: '09:00', to: '17:00', reason: '' });
  const [conflicts, setConflicts] = useState<number | null>(null);
  useEffect(() => { if (q.data) setRules(q.data.rules.map(r => ({ ...r, slotMinutes: r.slotMinutes ?? 60, breakMinutes: r.breakMinutes ?? 0 }))); }, [q.data]);
  const update = (i: number, patch: Partial<Rule>) => setRules(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const valid = rules.every(r => HHMM.test(r.startTime) && HHMM.test(r.endTime) && r.endTime > r.startTime);
  // نهاية الإجازة بعد بدايتها — يُتحقّق قبل الإرسال بدل رسالة «بعض البيانات غير صحيحة» العامة من الخادم
  const offValid = ISO_DAY.test(off.date) && HHMM.test(off.from) && HHMM.test(off.to) && off.to > off.from;
  const addTimeOff = () => {
    if (!offValid) return;
    addOff.mutate({ startsAt: new Date(`${off.date}T${off.from}:00+04:00`).toISOString(), endsAt: new Date(`${off.date}T${off.to}:00+04:00`).toISOString(), reason: off.reason.trim() || null },
      { onSuccess: r => { setConflicts(r.conflictingBookings.length); setOff({ date: '', from: '09:00', to: '17:00', reason: '' }); } });
  };

  return (
    <Screen onBack={() => safeBack(router)} title={t('teacherApp.availability')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
      footer={<Button label={save.isSuccess && !save.isPending ? t('settings.saved') : t('teacherUi.saveRules')} size="lg" full loading={save.isPending} disabled={!valid} onPress={() => save.mutate(rules)} />}>
      <View style={styles.wrap}>
        <Text role="body" tone="secondary">{t('teacherUi.availabilityHint')}</Text>
        {rules.length === 0 ? <View style={styles.warn}><Icon name="warning" size={16} color={colors.state.warning} /><Text role="small" tone="warning" style={styles.flex}>{t('teacherUi.noRules')}</Text></View> : null}
        {rules.map((r, i) => (
          <Card key={i}>
            <View style={styles.chips}>{DAYS.map((d, wd) => <Chip key={d} small label={t(`days.${d}`)} selected={r.weekday === wd} onPress={() => update(i, { weekday: wd })} />)}</View>
            <View style={[styles.row, styles.mt]}>
              <View style={styles.flex}><Input label={t('teacherUi.from')} value={r.startTime} onChangeText={v => update(i, { startTime: v })} placeholder="16:00" numeric keyboardType="numbers-and-punctuation" error={HHMM.test(r.startTime) ? undefined : ' '} /></View>
              <View style={styles.flex}><Input label={t('teacherUi.to')} value={r.endTime} onChangeText={v => update(i, { endTime: v })} placeholder="21:00" numeric keyboardType="numbers-and-punctuation" error={HHMM.test(r.endTime) && r.endTime > r.startTime ? undefined : ' '} /></View>
            </View>
            <View style={[styles.row, styles.mt, styles.center]}>
              <Text role="caption" tone="secondary">{t('teacherUi.slot')}</Text>{[30, 45, 60].map(m => <Chip key={m} small label={`${m} د`} selected={r.slotMinutes === m} onPress={() => update(i, { slotMinutes: m })} />)}
              <Text role="caption" tone="secondary">{t('teacherUi.breakM')}</Text>{[0, 10, 15].map(m => <Chip key={m} small label={`${m}`} selected={r.breakMinutes === m} onPress={() => update(i, { breakMinutes: m })} />)}
              <Button label={t('teacherUi.removeRule')} variant="ghost" size="sm" icon="trash" onPress={() => setRules(l => l.filter((_, j) => j !== i))} style={styles.remove} />
            </View>
          </Card>
        ))}
        <Button label={t('teacherUi.addRule')} icon="plus" variant="secondary" onPress={() => setRules(r => [...r, { weekday: 0, startTime: '16:00', endTime: '21:00', slotMinutes: 60, breakMinutes: 0 }])} />
        {save.error ? <Text role="small" tone="danger">{t(errorMessageKey(save.error))}</Text> : null}

        <SectionHeader title={t('teacherApp.timeOff')} />
        {q.data?.timeOff.length ? q.data.timeOff.map(o => (
          <Card key={o.id} style={styles.offRow}><View style={styles.flex}><Text role="bodyMedium" tabular>{formatDateTime(o.startsAt)} → {formatDateTime(o.endsAt)}</Text>{o.reason ? <Text role="caption" tone="secondary">{o.reason}</Text> : null}</View><Button label={t('teacherUi.removeRule')} variant="ghost" size="sm" icon="trash" onPress={() => o.id && removeOff.mutate(o.id)} /></Card>
        )) : <Text role="small" tone="tertiary">{t('teacherUi.noTimeOff')}</Text>}
        <Card>
          <Input label={t('booking.chooseDate')} value={off.date} onChangeText={v => setOff(s => ({ ...s, date: v }))} placeholder="2026-09-20" numeric keyboardType="numbers-and-punctuation" error={!off.date || ISO_DAY.test(off.date) ? undefined : ' '} />
          <View style={[styles.row, styles.mt]}><View style={styles.flex}><Input label={t('teacherUi.from')} value={off.from} onChangeText={v => setOff(s => ({ ...s, from: v }))} numeric keyboardType="numbers-and-punctuation" error={HHMM.test(off.from) ? undefined : ' '} /></View><View style={styles.flex}><Input label={t('teacherUi.to')} value={off.to} onChangeText={v => setOff(s => ({ ...s, to: v }))} numeric keyboardType="numbers-and-punctuation" error={offValid ? undefined : ' '} /></View></View>
          <Input label={t('teacherUi.reason')} value={off.reason} onChangeText={v => setOff(s => ({ ...s, reason: v }))} />
          <Button label={t('teacherUi.timeOffAdd')} icon="plus" size="sm" style={styles.mt} loading={addOff.isPending} disabled={!offValid} onPress={addTimeOff} />
          {conflicts ? <Text role="small" tone="warning" style={styles.mt}>{t('teacherUi.conflicts', { n: conflicts })}</Text> : null}
          {addOff.error ? <Text role="small" tone="danger">{t(errorMessageKey(addOff.error))}</Text> : null}
        </Card>
      </View>
    </Screen>
  );
}
const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  warn: { flexDirection: 'row', gap: spacing[2], alignItems: 'center', padding: spacing[3], backgroundColor: c.state.warningSoft, borderRadius: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  row: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  center: { alignItems: 'center' },
  mt: { marginTop: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  remove: { marginStart: 'auto' },
  offRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
}));
