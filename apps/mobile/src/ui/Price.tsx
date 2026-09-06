import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing } from '@manassah/tokens';
import { Text } from './Text';
import { money } from '@/lib/format';

export interface PriceProps {
  value: number;
  listPrice?: number | null;
  size?: 'sm' | 'md' | 'lg';
  /** «يبدأ من» */
  from?: boolean;
}

/** السعر واضح دائماً: أرقام جدولية، «مجاناً» بالأخضر، السعر الأصلي مشطوباً */
export function Price({ value, listPrice, size = 'md', from }: PriceProps) {
  const { t } = useTranslation();
  const role = size === 'lg' ? 'h2' : size === 'sm' ? 'number' : 'price';
  if (value === 0) return <Text role={role} tone="success">{t('common.free')}</Text>;
  const hasDiscount = listPrice != null && listPrice > value;
  return (
    <View style={styles.row}>
      {from ? <Text role="caption" tone="secondary">{t('common.from')}</Text> : null}
      <Text role={role} tabular>{money(value)}</Text>
      {hasDiscount ? <Text role="caption" tone="tertiary" tabular style={styles.strike}>{money(listPrice!)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[1], flexWrap: 'wrap' },
  strike: { textDecorationLine: 'line-through' },
});
