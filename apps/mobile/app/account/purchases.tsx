import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import { Screen, Text, Tabs, Button, Card, Badge, EmptyState } from '@/ui';
import { usePurchases } from '@/features/queries';
import { money, formatDayShort, formatDateTime } from '@/lib/format';

type Tab = 'books' | 'courses' | 'lessons' | 'orders';
const ORDER_TONE = { pending: 'warning', paid: 'success', failed: 'danger', refunded: 'neutral', partially_refunded: 'neutral', cancelled: 'neutral', expired: 'neutral' } as const;

/** مشترياتي: الكتب، الدورات، الحصص، الطلبات — من الملكيات الحقيقية */
export default function Purchases() {
  const { t } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('books');
  const q = usePurchases();
  const d = q.data;
  const empty = <EmptyState icon="receipt" title={t('purchasesUi.empty')} actionLabel={t('library.explore')} onAction={() => router.replace('/(tabs)/library')} />;
  return (
    <Screen onBack={() => router.back()} title={t('account.purchases')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Tabs value={tab} onChange={setTab} scrollable items={[{ key: 'books', label: t('account.purchasesTabs.books'), count: d?.books.length }, { key: 'courses', label: t('account.purchasesTabs.courses'), count: d?.courses.length }, { key: 'lessons', label: t('account.purchasesTabs.lessons'), count: d?.lessons.length }, { key: 'orders', label: t('purchasesUi.orders'), count: d?.orders.length }]} />
      <View style={styles.list}>
        {tab === 'books' ? (d?.books.length ? d.books.map(b => <Card key={b.id} style={styles.row}><View style={styles.flex}><Text role="bodyMedium" numberOfLines={2}>{b.title}</Text><Text role="caption" tone="tertiary" tabular>{formatDayShort(b.purchasedAt)}</Text></View><Button label={t('library.read')} size="sm" icon="book" onPress={() => router.push(`/book/${b.id}/read`)} /></Card>) : empty) : null}
        {tab === 'courses' ? (d?.courses.length ? d.courses.map(c => <Card key={c.id} onPress={() => router.push(`/course/${c.id}`)}><Text role="bodyMedium" numberOfLines={2}>{c.title}</Text><View style={styles.track}><View style={[styles.fill, { width: `${c.progressPercent}%` }]} /></View><Text role="caption" tone="secondary" tabular>{t('courses.progress', { p: Math.round(c.progressPercent) })}</Text></Card>) : empty) : null}
        {tab === 'lessons' ? (d?.lessons.length ? d.lessons.map(l => <Card key={l.bookingId} style={styles.row} onPress={() => router.push(`/lesson/${l.bookingId}`)}><View style={styles.flex}><Text role="bodyMedium">{l.subjectName} · {l.teacherName}</Text><Text role="caption" tone="secondary" tabular>{formatDateTime(l.startsAt)}</Text></View><View style={styles.end}><Text role="bodyMedium" tabular>{money(l.price)}</Text><Badge label={t(`lessons.status.${l.status}`)} /></View></Card>) : empty) : null}
        {tab === 'orders' ? (d?.orders.length ? d.orders.map(o => <Card key={o.id} style={styles.row} onPress={() => router.push(`/order/${o.number}`)}><View style={styles.flex}><Text role="bodyMedium" tabular>{o.number}</Text><Text role="caption" tone="secondary">{t('purchasesUi.items', { n: o.items.length })} · {formatDayShort(o.createdAt)}</Text></View><View style={styles.end}><Text role="bodyMedium" tabular>{money(o.total)}</Text><Badge label={t(`purchasesUi.status.${o.status}`)} tone={ORDER_TONE[o.status]} /></View></Card>) : empty) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing[3], paddingTop: spacing[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  end: { alignItems: 'flex-end', gap: 4 },
  track: { height: 5, borderRadius: radius.full, backgroundColor: colors.bg.subtle, overflow: 'hidden', marginTop: spacing[2] },
  fill: { height: '100%', backgroundColor: colors.state.success },
});
