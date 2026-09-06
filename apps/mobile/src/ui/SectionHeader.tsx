import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing } from '@manassah/tokens';
import { Text } from './Text';
import { Icon } from './Icon';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
}

/** عنوان قسم + «عرض الكل» — يُستخدم في كل قوائم الرئيسية والمكتبة */
export function SectionHeader({ title, subtitle, onSeeAll, seeAllLabel }: SectionHeaderProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text role="h3">{title}</Text>
        {subtitle ? <Text role="caption" tone="secondary">{subtitle}</Text> : null}
      </View>
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} hitSlop={8} style={styles.link} accessibilityRole="link">
          <Text role="caption" tone="link">{seeAllLabel ?? t('common.seeAll')}</Text>
          <Icon name="forward" size={14} color="#315D7A" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing[3], marginBottom: spacing[3] },
  text: { flex: 1, gap: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingBottom: 2 },
});
