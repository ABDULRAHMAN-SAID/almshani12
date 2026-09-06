import { View, Pressable, StyleSheet } from 'react-native';
import { colors, spacing } from '@manassah/tokens';
import { Text } from './Text';
import { Icon } from './Icon';

export interface RatingProps {
  value: number;
  count?: number;
  size?: number;
  /** عرض القيمة الرقمية بجانب النجوم */
  showValue?: boolean;
  /** يحوّل المكوّن إلى مُدخِل تقييم */
  onChange?: (value: number) => void;
}

/** نجوم ذهبية + القيمة + العدد. لا يُعرض عدد إن كان صفراً — لا أرقام وهمية */
export function Rating({ value, count, size = 14, showValue = true, onChange }: RatingProps) {
  const stars = [1, 2, 3, 4, 5].map(i => {
    const diff = value - i + 1;
    const name = diff >= 1 ? 'star' : diff >= 0.5 ? 'starHalf' : 'starOutline';
    const icon = <Icon name={name} size={size} color={colors.brand.gold} />;
    return onChange ? (
      <Pressable key={i} onPress={() => onChange(i)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${i}`}>
        {icon}
      </Pressable>
    ) : <View key={i}>{icon}</View>;
  });

  return (
    <View style={styles.row} accessibilityLabel={`التقييم ${value} من 5`}>
      <View style={[styles.stars, onChange && styles.starsInput]}>{stars}</View>
      {showValue && value > 0 ? <Text role="caption" tone="secondary" tabular>{value.toFixed(1)}</Text> : null}
      {count != null && count > 0 ? <Text role="caption" tone="tertiary" tabular>({count})</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  stars: { flexDirection: 'row', gap: 1 },
  starsInput: { gap: spacing[2] },
});
