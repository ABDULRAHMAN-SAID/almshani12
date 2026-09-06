import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import type { BookCard as BookCardData } from '@manassah/shared';
import { Text } from './Text';
import { Badge } from './Badge';
import { Rating } from './Rating';
import { Price } from './Price';
import { Icon } from './Icon';
import { compactNumber } from '@/lib/format';

export interface BookCardProps {
  book: BookCardData;
  onPress: () => void;
  /** عرض أفقي مضغوط للقوائم الطويلة */
  compact?: boolean;
  /** عرض ثابت داخل قائمة أفقية */
  width?: number;
}

const BADGE_TONE = { bestseller: 'brand', new: 'info', updated: 'success', verified: 'gold', free: 'success' } as const;

/** غلاف افتراضي بلون المادة — بلا صور عشوائية */
function Cover({ book, height }: { book: BookCardData; height: number }) {
  const { t } = useTranslation();
  const sc = subjectColors[(book.subject.colorKey as SubjectColorKey) ?? 'default'] ?? subjectColors.default;
  if (book.coverUrl) {
    return <Image source={{ uri: book.coverUrl }} style={[styles.cover, { height }]} contentFit="cover" transition={150} />;
  }
  return (
    <View style={[styles.cover, styles.coverFallback, { height, backgroundColor: sc.soft, borderStartColor: sc.main }]}>
      <Text role="caption" color={sc.main}>{t(`library.types.${book.type}`)}</Text>
      <Text role="h3" color={sc.main} numberOfLines={3} style={styles.coverTitle}>{book.title}</Text>
      <Text role="caption" color={sc.main}>{book.subject.name} · {book.grade.name}</Text>
    </View>
  );
}

export function BookCard({ book, onPress, compact, width }: BookCardProps) {
  const { t } = useTranslation();
  const badge = book.badges[0];

  if (compact) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}>
        <View style={styles.rowCover}><Cover book={book} height={96} /></View>
        <View style={styles.rowBody}>
          <Text role="bodyMedium" numberOfLines={2}>{book.title}</Text>
          <Text role="caption" tone="secondary" numberOfLines={1}>{book.subject.name} · {book.grade.name} · {book.author.name}</Text>
          <View style={styles.rowFoot}>
            {book.ratingCount > 0 ? <Rating value={book.ratingAvg} count={book.ratingCount} size={12} /> : <View />}
            {book.owned ? <Badge label={t('library.owned')} tone="success" icon="check" /> : <Price value={book.price} size="sm" />}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={book.title}
      style={({ pressed }) => [styles.card, width ? { width } : styles.fluid, pressed && styles.pressed]}>
      <View>
        <Cover book={book} height={150} />
        {badge ? <View style={styles.badgePos}><Badge label={t(`common.${badge}`)} tone={BADGE_TONE[badge]} /></View> : null}
        {book.favorited ? <View style={styles.heart}><Icon name="heartFilled" size={16} color={colors.brand.primary} /></View> : null}
      </View>
      <View style={styles.body}>
        <Text role="bodyMedium" numberOfLines={2} style={styles.title}>{book.title}</Text>
        <Text role="caption" tone="secondary" numberOfLines={1}>{book.subject.name} · {book.grade.name}</Text>
        <Text role="caption" tone="tertiary" numberOfLines={1}>{book.author.name}</Text>
        <View style={styles.meta}>
          {book.ratingCount > 0 ? <Rating value={book.ratingAvg} count={book.ratingCount} size={12} /> : null}
          {book.salesCount > 0 ? <Text role="caption" tone="tertiary" tabular>{t('library.sold', { n: compactNumber(book.salesCount) })}</Text> : null}
        </View>
        <View style={styles.foot}>
          {book.owned ? <Badge label={t('library.owned')} tone="success" icon="check" /> : <Price value={book.price} />}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.default, overflow: 'hidden' },
  fluid: { flex: 1 },
  pressed: { opacity: 0.9 },
  cover: { width: '100%', backgroundColor: colors.bg.subtle },
  coverFallback: { padding: spacing[3], justifyContent: 'flex-end', gap: 2, borderStartWidth: 4 },
  coverTitle: { lineHeight: 22 },
  badgePos: { position: 'absolute', top: spacing[2], start: spacing[2] },
  heart: { position: 'absolute', top: spacing[2], end: spacing[2], backgroundColor: colors.bg.card, borderRadius: 12, padding: 4 },
  body: { padding: spacing[3], gap: 2 },
  title: { minHeight: 44 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[1], minHeight: 18 },
  foot: { marginTop: spacing[2], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowCard: { flexDirection: 'row', gap: spacing[3], backgroundColor: colors.bg.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.default, padding: spacing[2], overflow: 'hidden' },
  rowCover: { width: 72, borderRadius: radius.sm, overflow: 'hidden' },
  rowBody: { flex: 1, justifyContent: 'space-between', paddingVertical: 2, gap: 2 },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing[1] },
});
