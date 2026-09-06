import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '@manassah/tokens';
import { Text } from './Text';

export interface TabItem<K extends string = string> { key: K; label: string; count?: number }

export interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** تمرير أفقي عند كثرة التبويبات */
  scrollable?: boolean;
}

/** تبويبات مقسّمة داخل حبّة — التبويب النشط أبيض بارز، والباقي رمادي */
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
        <Text role="caption" tone={active ? 'primary' : 'secondary'} style={styles.label} numberOfLines={1}>
          {item.label}{item.count != null ? ` (${item.count})` : ''}
        </Text>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.bar, styles.scrollRow]}>
        {content}
      </ScrollView>
    );
  }
  return <View style={[styles.bar, styles.row]}>{content}</View>;
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.bg.subtle, borderRadius: radius.full, padding: 4 },
  row: { flexDirection: 'row' },
  scrollRow: { flexDirection: 'row', alignSelf: 'flex-start' },
  tab: { height: 42, justifyContent: 'center', alignItems: 'center', borderRadius: radius.full, paddingHorizontal: spacing[3] },
  tabFlex: { flex: 1 },
  tabScroll: { paddingHorizontal: spacing[4] },
  tabActive: { backgroundColor: colors.bg.card, shadowColor: '#5A4A2A', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  label: { fontSize: 15, lineHeight: 22 },
});
