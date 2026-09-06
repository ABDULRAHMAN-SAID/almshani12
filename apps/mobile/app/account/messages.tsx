import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { Screen, Text, Avatar, EmptyState } from '@/ui';
import { useConversations } from '@/features/queries';
import { formatDayShort } from '@/lib/format';

export default function Messages() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useConversations();
  return (
    <Screen onBack={() => router.back()} title={t('messagesUi.title')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} refreshing={q.isRefetching} onRefresh={() => q.refetch()}
      empty={!!q.data && q.data.length === 0} emptyProps={{ icon: 'message', title: t('messagesUi.empty'), body: t('messagesUi.emptyHint'), actionLabel: t('teachers.find'), onAction: () => router.replace('/teachers') }}>
      <View style={styles.list}>
        {q.data?.map(c => (
          <Pressable key={c.id} onPress={() => router.push(`/conversation/${c.id}`)} style={styles.row} accessibilityRole="button">
            <Avatar name={c.other.name} url={c.other.avatarUrl} size="md" />
            <View style={styles.flex}><View style={styles.top}><Text role={c.unread ? 'bodyMedium' : 'body'} numberOfLines={1} style={styles.flex}>{c.other.name}</Text>{c.lastAt ? <Text role="caption" tone="tertiary" tabular>{formatDayShort(c.lastAt)}</Text> : null}</View>
              <Text role="small" tone="secondary" numberOfLines={1}>{c.lastMessage ?? (c.context ? c.context.title : '')}</Text></View>
            {c.unread ? <View style={styles.badge}><Text role="caption" tone="inverse" tabular>{c.unread}</Text></View> : null}
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
const styles = themed((c) => StyleSheet.create({
  list: { gap: spacing[2], paddingTop: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: radius.md, backgroundColor: c.bg.card, borderWidth: 1.5, borderColor: c.border.default },
  flex: { flex: 1, minWidth: 0 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.brand.primary, alignItems: 'center', justifyContent: 'center' },
}));
