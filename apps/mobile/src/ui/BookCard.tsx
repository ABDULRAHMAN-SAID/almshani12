import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, shadow, subjectColors, subjectIcons, type SubjectColorKey, themed } from '@manassah/tokens';
import type { BookCard as BookCardData } from '@manassah/shared';
import { Text } from './Text';
import { Badge } from './Badge';
import { Rating } from './Rating';
import { Price } from './Price';
import { Icon } from './Icon';

export interface BookCardProps {
  book: BookCardData;
  onPress: () => void;
  /** عرض أفقي مضغوط للقوائم الطويلة */
  compact?: boolean;
  /** عرض ثابت داخل قائمة أفقية */
  width?: number;
}

const BADGE_TONE = { bestseller: 'brand', new: 'info', updated: 'success', verified: 'gold', free: 'success' } as const;
const subj = (key: string | null | undefined) => {
  const k = (key && key in subjectColors ? key : 'default') as SubjectColorKey;
  return { ...subjectColors[k], icon: subjectIcons[k] as keyof typeof Ionicons.glyphMap };
};

/** غلاف بلون المادة وأيقونتها — قوي وواضح بلا صور عشوائية */
function Cover({ book, height, small }: { book: BookCardData; height: number; small?: boolean }) {
  const { t } = useTranslation();
  const sc = subj(book.subject.colorKey);
  if (book.coverUrl) {
    return <Image source={{ uri: book.coverUrl }} style={[styles.cover, { height }]} contentFit="cover" transition={150} />;
  }
  return (
    <View style={[styles.cover, styles.coverFallback, { height, backgroundColor: sc.main }]}>
      <Ionicons name={sc.icon} size={small ? 54 : 96} color="#FFFFFF" style={styles.watermark} />
      {!small ? <View style={styles.typePill}><Text role="caption" color={sc.main}>{t(`library.types.${book.type}`)}</Text></View> : null}
      <Text role={small ? 'caption' : 'h3'} tone="inverse" numberOfLines={small ? 2 : 3} style={styles.coverTitle}>{book.title}</Text>
    </View>
  );
}

export function BookCard({ book, onPress, compact, width }: BookCardProps) {
  const { t } = useTranslation();
  const badge = book.badges[0];

  if (compact) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}>
        <View style={styles.rowCover}><Cover book={book} height={100} small /></View>
        <View style={styles.rowBody}>
          <Text role="bodyMedium" numberOfLines={2}>{book.title}</Text>
          <Text role="caption" tone="secondary" numberOfLines={1}>{book.subject.name} · {book.grade.name}</Text>
          <View style={styles.rowFoot}>
            {book.ratingCount > 0 ? <Rating value={book.ratingAvg} count={book.ratingCount} size={13} /> : <View />}
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
        <Cover book={book} height={156} />
        {badge ? <View style={styles.badgePos}><Badge label={t(`common.${badge}`)} tone={BADGE_TONE[badge]} /></View> : null}
        {book.favorited ? <View style={styles.heart}><Icon name="heartFilled" size={16} color={colors.brand.primary} /></View> : null}
      </View>
      <View style={styles.body}>
        {book.coverUrl
          ? <Text role="bodyMedium" numberOfLines={2} style={styles.title}>{book.title}</Text>
          : <Text role="bodyMedium" numberOfLines={2} style={styles.title}>{book.subject.name} · {book.grade.name}</Text>}
        <Text role="caption" tone="secondary" numberOfLines={1}>{book.author.name}</Text>
        <View style={styles.foot}>
          {book.owned ? <Badge label={t('library.owned')} tone="success" icon="check" /> : <Price value={book.price} />}
          {book.ratingCount > 0 ? <Rating value={book.ratingAvg} size={13} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = themed((c) => StyleSheet.create({
  card: { backgroundColor: c.bg.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border.default, overflow: 'hidden', ...shadow.card },
  fluid: { flex: 1 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  cover: { width: '100%', backgroundColor: c.bg.subtle },
  coverFallback: { padding: spacing[3], justifyContent: 'flex-end', gap: spacing[1], overflow: 'hidden' },
  watermark: { position: 'absolute', top: -14, end: -18, opacity: 0.22 },
  typePill: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: radius.full, paddingHorizontal: spacing[2], height: 24, justifyContent: 'center' },
  coverTitle: { lineHeight: 24 },
  badgePos: { position: 'absolute', top: spacing[2], start: spacing[2] },
  heart: { position: 'absolute', top: spacing[2], end: spacing[2], backgroundColor: c.bg.card, borderRadius: 14, padding: 5 },
  body: { padding: spacing[3], gap: 2 },
  title: { minHeight: 52 },
  foot: { marginTop: spacing[2], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  rowCard: { flexDirection: 'row', gap: spacing[3], backgroundColor: c.bg.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border.default, padding: spacing[2], overflow: 'hidden' },
  rowCover: { width: 80, borderRadius: radius.md, overflow: 'hidden' },
  rowBody: { flex: 1, justifyContent: 'space-between', paddingVertical: 2, gap: 2 },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing[1] },
}));
