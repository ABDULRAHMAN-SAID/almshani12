import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, subjectColors, subjectIcons, type SubjectColorKey } from '@manassah/tokens';
import { Screen, Text, Icon, Button, IconButton, Chip, Badge, Avatar, Rating, Price, SectionHeader, BookCard, ReviewList, ReviewSheet, Expandable, VerifiedBadge } from '@/ui';
import { useBook, useAddToCart, useCart, useToggleFavorite } from '@/features/queries';
import { formatDayShort } from '@/lib/format';

const BADGE_TONE = { bestseller: 'brand', new: 'info', updated: 'success', verified: 'gold', free: 'success' } as const;

/** صفحة الكتاب — كمتجر محترف: كل ما يحتاجه الطالب ليقرّر، والفعل الرئيسي واحد */
export default function BookDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = Number(id);
  const book = useBook(bookId);
  const cart = useCart();
  const add = useAddToCart();
  const fav = useToggleFavorite();
  const [review, setReview] = useState(false);
  const b = book.data;
  const inCart = !!cart.data?.items.some(i => i.itemType === 'book' && i.itemId === bookId);
  const sk = ((b?.subject.colorKey && b.subject.colorKey in subjectColors ? b.subject.colorKey : 'default') as SubjectColorKey);
  const sc = subjectColors[sk];

  const footer = b ? (
    b.owned ? <Button label={t('library.read')} icon="book" size="lg" full onPress={() => router.push(`/book/${bookId}/read`)} />
      : (
        <View style={styles.footer}>
          <View style={styles.footPrice}><Price value={b.price} /><Text role="caption" tone="tertiary" numberOfLines={1}>{t('book.securePay')}</Text></View>
          {b.price > 0 ? (
            <IconButton icon={inCart ? 'check' : 'cart'} label={inCart ? t('book.inCart') : t('book.addToCart')} disabled={inCart} loading={add.isPending}
              onPress={() => add.mutate({ itemType: 'book', itemId: bookId })} />
          ) : null}
          <Button label={b.price > 0 ? t('book.buyNow') : t('library.read')} icon={b.price > 0 ? undefined : 'book'} style={styles.footBtn}
            onPress={() => b.price > 0 ? router.push({ pathname: '/checkout', params: { items: JSON.stringify([{ itemType: 'book', itemId: bookId }]) } }) : router.push(`/book/${bookId}/read`)} />
        </View>
      )
  ) : null;

  return (
    <Screen onBack={() => router.back()} title={b?.title ?? ''} loading={book.isLoading} error={book.error} onRetry={() => book.refetch()} padded={false} footer={footer}
      right={b ? (
        <Pressable onPress={() => fav.mutate({ targetType: 'book', targetId: bookId })} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('account.favorites')}>
          <Icon name={b.favorited ? 'heartFilled' : 'heart'} size={22} color={b.favorited ? colors.brand.primary : colors.text.primary} />
        </Pressable>) : undefined}>
      {b ? (
        <View>
          {/* الغلاف والعنوان */}
          <View style={[styles.hero, { backgroundColor: sc.soft }]}>
            {b.coverUrl ? <Image source={{ uri: b.coverUrl }} style={styles.cover} contentFit="cover" /> : (
              <View style={[styles.cover, styles.coverFallback, { backgroundColor: sc.main }]}>
                <Ionicons name={subjectIcons[sk] as keyof typeof Ionicons.glyphMap} size={150} color="#FFFFFF" style={styles.watermark} />
                <View style={styles.typePill}><Text role="caption" color={sc.main}>{t(`library.types.${b.type}`)}</Text></View>
                <Text role="h2" tone="inverse" numberOfLines={4}>{b.title}</Text>
              </View>
            )}
            <View style={styles.badges}>{b.badges.map(x => <Badge key={x} label={t(`common.${x}`)} tone={BADGE_TONE[x]} />)}</View>
          </View>
          <View style={styles.px}>
            <Text role="h1" style={styles.title}>{b.title}</Text>
            <View style={styles.chips}>
              <Chip small label={b.subject.name} color={sc.main} softColor={sc.soft} onPress={() => router.push({ pathname: '/(tabs)/library', params: { subjectId: String(b.subject.id) } })} />
              <Chip small label={b.grade.name} />
              {b.semesterName ? <Chip small label={b.semesterName} /> : null}
              <Chip small label={t(`library.types.${b.type}`)} />
            </View>
            <Pressable onPress={() => router.push(`/teacher/${b.author.id}`)} style={styles.author} accessibilityRole="button">
              <Avatar name={b.author.name} url={b.author.avatarUrl} size="sm" verified={b.author.verified} />
              <Text role="bodyMedium" style={styles.flex} numberOfLines={1}>{b.author.name}</Text>
              {b.author.verified ? <VerifiedBadge label={t('common.verified')} /> : null}
            </Pressable>
            <View style={styles.stats}>
              {b.ratingCount > 0 ? <Rating value={b.ratingAvg} count={b.ratingCount} size={14} /> : <Text role="caption" tone="tertiary">{t('common.reviews')}: 0</Text>}
              {b.salesCount > 0 ? <Text role="caption" tone="tertiary" tabular>{t('library.sold', { n: b.salesCount })}</Text> : null}
              {b.pages ? <Text role="caption" tone="tertiary" tabular>{b.pages} {t('common.pages')}</Text> : null}
            </View>
            {!b.owned && b.previewPages > 0 ? <Button label={t('book.preview')} variant="ghost" icon="book" onPress={() => router.push(`/book/${bookId}/read`)} style={styles.previewBtn} /> : null}

            <View style={styles.trust}>
              {[['lock', 'book.protected'], ['refresh', 'book.refundPolicy'], ['verified', 'book.securePay']].map(([icon, key]) => (
                <View key={key} style={styles.trustItem}><Icon name={icon as never} size={16} color={colors.state.success} /><Text role="caption" tone="secondary" style={styles.flex}>{t(key)}</Text></View>
              ))}
            </View>

            {b.description ? <View style={styles.section}><SectionHeader title={t('book.description')} /><Expandable text={b.description} /></View> : null}
            {b.learnPoints.length ? (
              <View style={styles.section}><SectionHeader title={t('book.learn')} />
                {b.learnPoints.map((p, i) => <View key={i} style={styles.point}><Icon name="checkCircle" size={18} color={colors.state.success} /><Text role="body" style={styles.flex}>{p}</Text></View>)}
              </View>
            ) : null}
            {b.toc.length ? (
              <View style={styles.section}><SectionHeader title={t('book.contents')} />
                <View style={styles.toc}>{b.toc.map((e, i) => (
                  <View key={i} style={[styles.tocRow, i < b.toc.length - 1 && styles.tocBorder]}><Text role="body" style={styles.flex}>{e.title}</Text>{e.page ? <Text role="small" tone="tertiary" tabular>{e.page}</Text> : null}</View>
                ))}</View>
              </View>
            ) : null}
            <View style={styles.section}>
              <View style={styles.meta}>
                {[[t('book.pages'), b.pages], [t('book.edition'), b.edition], [t('book.updatedAt'), formatDayShort(b.updatedAt)], [t('book.language'), b.language === 'en' ? 'English' : 'العربية'], [t('book.level'), b.level]].filter(x => x[1]).map(([k, v]) => (
                  <View key={String(k)} style={styles.metaItem}><Text role="caption" tone="tertiary">{String(k)}</Text><Text role="bodyMedium" tabular>{String(v)}</Text></View>
                ))}
              </View>
            </View>
            {b.samplePageUrls.length ? (
              <View style={styles.section}><SectionHeader title={t('book.samples')} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.samples}>
                  {b.samplePageUrls.map((u, i) => <Image key={i} source={{ uri: u }} style={styles.sample} contentFit="cover" />)}
                </ScrollView>
              </View>
            ) : null}
            <View style={styles.section}>
              <SectionHeader title={t('book.reviews')} onSeeAll={b.canReview ? () => setReview(true) : undefined} seeAllLabel={t('book.writeReview')} />
              <ReviewList items={b.reviews} avg={b.ratingAvg} count={b.ratingCount} />
            </View>
          </View>
          {b.similar.length ? (
            <View style={styles.section}><View style={styles.px}><SectionHeader title={t('book.similar')} /></View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>{b.similar.map(x => <BookCard key={x.id} book={x} width={168} onPress={() => router.push(`/book/${x.id}`)} />)}</ScrollView>
            </View>
          ) : null}
          {b.byAuthor.length ? (
            <View style={styles.section}><View style={styles.px}><SectionHeader title={t('book.byAuthor')} onSeeAll={() => router.push(`/teacher/${b.author.id}`)} /></View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>{b.byAuthor.map(x => <BookCard key={x.id} book={x} width={168} onPress={() => router.push(`/book/${x.id}`)} />)}</ScrollView>
            </View>
          ) : null}
          <ReviewSheet visible={review} onClose={() => setReview(false)} targetType="book" targetId={bookId} onDone={() => book.refetch()} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  px: { paddingHorizontal: spacing[4] },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', paddingVertical: spacing[5] },
  cover: { width: 180, height: 240, borderRadius: radius.lg, backgroundColor: colors.bg.card, shadowColor: '#1E2430', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  coverFallback: { padding: spacing[3], justifyContent: 'flex-end', gap: spacing[2], overflow: 'hidden' },
  watermark: { position: 'absolute', top: -24, start: -34, opacity: 0.2, transform: [{ rotate: '-12deg' }] },
  typePill: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderRadius: radius.full, paddingHorizontal: spacing[3], height: 26, justifyContent: 'center' },
  badges: { flexDirection: 'row', gap: spacing[1], position: 'absolute', top: spacing[3], start: spacing[4] },
  title: { marginTop: spacing[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[2] },
  author: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  stats: { flexDirection: 'row', gap: spacing[3], alignItems: 'center', marginTop: spacing[2], flexWrap: 'wrap' },
  previewBtn: { marginTop: spacing[2] },
  trust: { marginTop: spacing[4], backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border.default, padding: spacing[3], gap: spacing[2] },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  section: { marginTop: spacing[6] },
  point: { flexDirection: 'row', gap: spacing[2], alignItems: 'flex-start', marginBottom: spacing[2] },
  toc: { backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border.default, paddingHorizontal: spacing[3] },
  tocRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[3] },
  tocBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  metaItem: { minWidth: '30%', gap: 2 },
  samples: { flexDirection: 'row', gap: spacing[2] },
  sample: { width: 120, height: 160, borderRadius: radius.sm, backgroundColor: colors.bg.subtle },
  hList: { paddingHorizontal: spacing[4], gap: spacing[3] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  footPrice: { flex: 1, minWidth: 0 },
  footBtn: { flex: 1.3 },
});
