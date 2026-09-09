import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import type { z } from 'zod';
import type { Notification } from '@manassah/shared';
import { Screen, Text, Icon, Button, EmptyState, type IconName } from '@/ui';
import { useNotifications, useMarkRead } from '@/features/queries';
import { formatDateTime } from '@/lib/format';

const ICON: Record<string, IconName> = { lesson_in_1h: 'clock', lesson_in_15m: 'clock', booking_confirmed: 'calendar', booking_cancelled_by_teacher: 'warning', refund_processed: 'wallet', message: 'message', homework: 'document', teacher_verified: 'verified', payout_processed: 'wallet', wallet_adjusted: 'wallet', content_approved: 'checkCircle', content_rejected: 'warning', teacher_rejected: 'warning', teacher_document_rejected: 'document' };

export default function Notifications() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useNotifications();
  const mark = useMarkRead();
  const open = (n: z.infer<typeof Notification>) => {
    if (!n.readAt) mark.mutate([n.id]);
    const d = n.data ?? {};
    if (d.bookingId) router.push(`/lesson/${d.bookingId}`);
    else if (d.conversationId) router.push(`/conversation/${d.conversationId}`);
    // إشعار بيع يخصّ المعلّم البائع → أرباحه، لا صفحة مشترياته الفارغة
    else if (d.teacherSale) router.push('/teacher-app/earnings');
    else if (d.orderId) router.push('/account/purchases');
    else if (d.bookId) router.push(`/book/${d.bookId}`);
    else if (d.courseId) router.push(`/course/${d.courseId}`);
    else if (d.payoutId) router.push('/teacher-app/earnings');
    // تعديل رصيد من الإدارة يفتح المحفظة، ومستند مرفوض يفتح ملفّ المعلّم
    else if (n.type === 'wallet_adjusted') router.push('/account/wallet');
    else if (n.type === 'teacher_document_rejected') router.push('/teacher-app/documents');
    else if (d.teacherId || n.type === 'teacher_verified' || n.type === 'teacher_rejected') router.push('/teacher-app');
  };
  return (
    <Screen onBack={() => router.back()} title={t('notificationsUi.title')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} refreshing={q.isRefetching} onRefresh={() => q.refetch()}
      right={q.data?.unread ? <Button label={t('notificationsUi.markAll')} variant="ghost" size="sm" onPress={() => mark.mutate(undefined)} /> : undefined}
      empty={!!q.data && q.data.data.length === 0} emptyProps={{ icon: 'bell', title: t('notificationsUi.empty'), body: t('notificationsUi.emptyHint') }}>
      <View style={styles.list}>
        {q.data?.data.map(n => (
          <Pressable key={n.id} onPress={() => open(n)} style={[styles.row, !n.readAt && styles.unread]} accessibilityRole="button">
            <View style={styles.icon}><Icon name={ICON[n.type] ?? 'bell'} size={20} color={colors.brand.primary} /></View>
            <View style={styles.flex}><Text role={n.readAt ? 'body' : 'bodyMedium'}>{n.title}</Text>{n.body ? <Text role="small" tone="secondary" numberOfLines={2}>{n.body}</Text> : null}<Text role="caption" tone="tertiary" tabular>{formatDateTime(n.createdAt)}</Text></View>
            {!n.readAt ? <View style={styles.dot} /> : null}
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
const styles = themed((c) => StyleSheet.create({
  list: { gap: spacing[2], paddingTop: spacing[2] },
  row: { flexDirection: 'row', gap: spacing[3], alignItems: 'flex-start', padding: spacing[3], borderRadius: radius.md, backgroundColor: c.bg.card, borderWidth: 1.5, borderColor: c.border.default },
  unread: { borderColor: c.brand.primary, backgroundColor: c.brand.primarySoft },
  icon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: c.brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.brand.primary, marginTop: 6 },
}));
