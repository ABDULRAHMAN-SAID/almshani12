import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, themed } from '@manassah/tokens';
import { Screen, Text, Card, Icon, SectionHeader } from '@/ui';
import { useWallet } from '@/features/queries';
import { money, formatDateTime } from '@/lib/format';

export default function Wallet() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useWallet();
  const d = q.data;
  return (
    <Screen onBack={() => router.back()} title={t('walletUi.title')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {d ? (
        <View style={styles.wrap}>
          <Card accent><View style={styles.balance}><Icon name="wallet" size={26} color={colors.brand.primary} /><View><Text role="caption" tone="secondary">{t('walletUi.balance')}</Text><Text role="display" tabular>{money(d.balance)}</Text></View></View><Text role="caption" tone="tertiary">{t('walletUi.note')}</Text></Card>
          <SectionHeader title={t('walletUi.history')} />
          {d.transactions.length === 0 ? <Text role="small" tone="tertiary" center>{t('walletUi.empty')}</Text> : (
            <Card padded={false}><View style={styles.list}>{d.transactions.map((tx, i) => (
              <View key={tx.id} style={[styles.row, i < d.transactions.length - 1 && styles.border]}>
                <View style={styles.flex}><Text role="bodyMedium">{t(`walletUi.types.${tx.type}`)}</Text>{tx.note ? <Text role="caption" tone="secondary" numberOfLines={1}>{tx.note}</Text> : null}<Text role="caption" tone="tertiary" tabular>{formatDateTime(tx.createdAt)}</Text></View>
                <View style={styles.end}><Text role="bodyMedium" tabular tone={tx.amount >= 0 ? 'success' : 'primary'}>{tx.amount >= 0 ? '+' : '−'}{money(Math.abs(tx.amount))}</Text><Text role="caption" tone="tertiary" tabular>{money(tx.balanceAfter)}</Text></View>
              </View>
            ))}</View></Card>
          )}
        </View>
      ) : null}
    </Screen>
  );
}
const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  balance: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[2] },
  list: { paddingHorizontal: spacing[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.default },
  flex: { flex: 1, minWidth: 0 },
  end: { alignItems: 'flex-end' },
}));
