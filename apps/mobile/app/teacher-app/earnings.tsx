import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, themed } from '@manassah/tokens';
import { Screen, Text, Button, Input, Chip, Card, Badge, SectionHeader } from '@/ui';
import { useTeacherEarnings, useRequestPayout } from '@/features/queries';
import { errorMessageKey } from '@/api/client';
import { money, formatDayShort } from '@/lib/format';

/** الأرباح: إجمالي/عمولة/صافي، قيد التسوية/متاح/مصروف، تفصيل بالمصدر، وطلب سحب بحدّ أدنى من الإعدادات */
export default function Earnings() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useTeacherEarnings();
  const payout = useRequestPayout();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'bank' | 'wallet'>('bank');
  const [iban, setIban] = useState('');
  const d = q.data;
  const requested = d?.requested ?? 0;
  // بلاطتان في الصف وسطر واحد لا يُقصّ: المبلغ لا ينكسر في منتصف الرقم على شاشة 390
  const tile = (label: string, value: number, tone: 'primary' | 'success' | 'warning' | 'secondary' = 'primary') => (
    <Card key={label} style={styles.tile}><Text role="caption" tone="secondary" numberOfLines={1}>{label}</Text><Text role="h3" tabular tone={tone} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{money(value)}</Text></Card>
  );
  return (
    <Screen onBack={() => router.back()} title={t('teacherApp.earnings')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {d ? (
        <View style={styles.wrap}>
          <View style={styles.grid}>
            {tile(t('teacherApp.gross'), d.gross)}{tile(t('teacherApp.commission'), d.commission, 'secondary')}{tile(t('teacherApp.net'), d.net)}
            {tile(t('teacherApp.pending'), d.pending, 'warning')}{tile(t('teacherApp.available'), d.available, 'success')}
            {requested > 0 ? tile(t('teacherApp.requested'), requested, 'warning') : null}{tile(t('teacherApp.paid'), d.paid, 'secondary')}
          </View>
          <Text role="caption" tone="tertiary">{t('teacherUi.commissionNote', { p: Math.round(d.commissionRate * 100) })}</Text>
          <Card><Text role="h3" style={styles.mb}>{t('teacherApp.earnings')}</Text>
            {[[t('lessons.title'), d.breakdown.lessons], [t('library.title'), d.breakdown.books], [t('courses.title'), d.breakdown.courses]].map(([k, v]) => <View key={String(k)} style={styles.line}><Text role="body" tone="secondary">{String(k)}</Text><Text role="body" tabular>{money(Number(v))}</Text></View>)}
          </Card>
          <SectionHeader title={t('teacherApp.requestPayout')} subtitle={t('teacherUi.payoutMin', { p: money(d.minPayout) })} />
          <Card>
            <Input label={t('teacherUi.payoutAmount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" numeric placeholder={money(d.available)} />
            <View style={[styles.chips, styles.mt]}><Chip label={t('checkout.bank')} selected={method === 'bank'} onPress={() => setMethod('bank')} /><Chip label={t('account.wallet')} selected={method === 'wallet'} onPress={() => setMethod('wallet')} /></View>
            {method === 'bank' ? <Input label="IBAN" value={iban} onChangeText={setIban} autoCapitalize="characters" placeholder="OM.." /> : null}
            <Button label={payout.isSuccess ? t('teacherUi.payoutRequested') : t('teacherApp.requestPayout')} style={styles.mt} loading={payout.isPending} disabled={!(Number(amount) >= d.minPayout && Number(amount) <= d.available) || payout.isSuccess}
              onPress={() => payout.mutate({ amount: Number(amount), method, details: method === 'bank' ? { iban } : {} })} />
            <Text role="caption" tone="tertiary" style={styles.mt}>{t('teacherUi.requestPayoutHint')}</Text>
            {payout.error ? <Text role="small" tone="danger">{t(errorMessageKey(payout.error))}</Text> : null}
          </Card>
          {d.payouts.length ? <View><SectionHeader title={t('teacherUi.payouts')} /><Card padded={false}><View style={styles.list}>{d.payouts.map((p, i) => <View key={p.id} style={[styles.line, styles.pad, i < d.payouts.length - 1 && styles.border]}><View><Text role="bodyMedium" tabular>{money(p.amount)}</Text><Text role="caption" tone="tertiary" tabular>{formatDayShort(p.requestedAt)}</Text></View><Badge label={t(`teacherUi.payoutStatus.${p.status}`)} tone={p.status === 'paid' ? 'success' : p.status === 'rejected' ? 'danger' : 'warning'} /></View>)}</View></Card></View> : null}
        </View>
      ) : null}
    </Screen>
  );
}
const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  tile: { width: '47%', flexGrow: 1, gap: 2 },
  mb: { marginBottom: spacing[2] }, mt: { marginTop: spacing[3] },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[1] },
  chips: { flexDirection: 'row', gap: spacing[2] },
  list: { paddingHorizontal: spacing[4] },
  pad: { paddingVertical: spacing[3] },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.default },
}));
