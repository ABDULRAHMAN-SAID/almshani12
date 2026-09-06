import { View, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, themed } from '@manassah/tokens';
import { Text } from './Text';
import { Icon } from './Icon';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
}

/** عنوان قسم كبير + زر «الكل» كحبّة — يُستخدم في كل قوائم الرئيسية والمكتبة */
export function SectionHeader({ title, subtitle, onSeeAll, seeAllLabel }: SectionHeaderProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text role="h2" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text role="small" tone="secondary" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} hitSlop={8} style={({ pressed }) => [styles.link, pressed && styles.pressed]} accessibilityRole="link">
          <Text role="caption" tone="brand">{seeAllLabel ?? t('common.seeAll')}</Text>
          <Icon name="forward" size={15} color={colors.brand.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3], marginBottom: spacing[3] },
  text: { flex: 1, minWidth: 0 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 34, paddingStart: spacing[3], paddingEnd: spacing[2], borderRadius: radius.full, backgroundColor: c.brand.primarySoft },
  pressed: { opacity: 0.7 },
}));
