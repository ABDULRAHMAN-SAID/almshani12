import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, hitTarget } from '@manassah/tokens';
import { Text } from './Text';

export interface TabItem<K extends string = string> { key: K; label: string; count?: number }

export interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** تمرير أفقي عند كثرة التبويبات */
  scrollable?: boolean;
}

/** تبويبات بخطّ سفلي — الحالة النشطة بالخطّ والوزن معاً */
export function Tabs<K extends string>({ items, value, onChange, scrollable }: TabsProps<K>) {
  const content = items.map(item => {
    const active = item.key === value;
    return (
      <Pressable
        key={item.key}
        onPress={() => onChange(item.key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        style={[styles.tab, scrollable ? styles.tabScroll : styles.tabFlex, active && styles.tabActive]}
      >
        <Text role={active ? 'bodyMedium' : 'body'} tone={active ? 'primary' : 'secondary'}>
          {item.label}{item.count != null ? ` (${item.count})` : ''}
        </Text>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow} style={styles.bar}>
        {content}
      </ScrollView>
    );
  }
  return <View style={[styles.bar, styles.row]}>{content}</View>;
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: 1, borderBottomColor: colors.border.default },
  row: { flexDirection: 'row' },
  scrollRow: { flexDirection: 'row', paddingHorizontal: spacing[1] },
  tab: { height: hitTarget, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabFlex: { flex: 1 },
  tabScroll: { paddingHorizontal: spacing[3] },
  tabActive: { borderBottomColor: colors.brand.primary },
});
