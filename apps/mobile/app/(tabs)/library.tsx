import { useEffect, useMemo, useState } from 'react';
import { View, FlatList, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import { BookType, type BookCard as BookCardData } from '@manassah/shared';
import { Screen, Text, Chip, Button, Tabs, SearchInput, BookCard, BottomSheet, CardSkeleton, EmptyState, ErrorState, HeaderActions } from '@/ui';
import { useBooks, useCatalog, usePurchases } from '@/features/queries';
import { useAuth } from '@/state/auth';
import { useUi } from '@/state/ui';
import { useDebounced } from '@/lib/hooks';

const TYPES = BookType.options;
const SORTS = ['bestselling', 'newest', 'rating', 'price_asc', 'price_desc'] as const;

/** المكتبة: بحث + فلاتر (النوع/المادة/الصف/السعر/الترتيب) + شبكة كتب — و«مكتبتي» لما اشتريته */
export default function Library() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; subjectId?: string }>();
  const user = useAuth(s => s.user);
  const { bookFilters, setBookFilters } = useUi();
  const [tab, setTab] = useState<'explore' | 'mine'>('explore');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(false);
  const dq = useDebounced(q, 300);
  const catalog = useCatalog();

  // فلتر أوّلي: صف الطالب + ما جاء من الرابط
  useEffect(() => {
    setBookFilters({ ...bookFilters, gradeId: bookFilters.gradeId ?? user?.student?.gradeId ?? undefined, ...(params.type ? { type: params.type as never } : {}), ...(params.subjectId ? { subjectId: Number(params.subjectId) } : {}) });
  }, [params.type, params.subjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = useMemo(() => ({ ...bookFilters, q: dq || undefined }), [bookFilters, dq]);
  const books = useBooks(filters);
  const purchases = usePurchases();
  const items = useMemo(() => books.data?.pages.flatMap(p => p.data) ?? [], [books.data]);
  const activeCount = ['type', 'subjectId', 'semesterId', 'free', 'minRating'].filter(k => (bookFilters as Record<string, unknown>)[k] != null).length + (bookFilters.sort && bookFilters.sort !== 'bestselling' ? 1 : 0);
  const grades = catalog.data?.grades ?? [], subjects = catalog.data?.subjects ?? [];
  const reset = () => setBookFilters({ gradeId: user?.student?.gradeId ?? undefined });

  const explore = (
    <FlatList
      data={items} keyExtractor={b => String(b.id)} numColumns={2} columnWrapperStyle={styles.cols} contentContainerStyle={styles.grid}
      renderItem={({ item }) => <BookCard book={item} onPress={() => router.push(`/book/${item.id}`)} />}
      onEndReached={() => books.hasNextPage && !books.isFetchingNextPage && books.fetchNextPage()} onEndReachedThreshold={0.6}
      refreshing={books.isRefetching} onRefresh={() => books.refetch()}
      ListHeaderComponent={
        <View style={styles.head}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label={t('common.all')} selected={!bookFilters.type} onPress={() => setBookFilters({ ...bookFilters, type: undefined })} />
            {TYPES.map(ty => <Chip key={ty} label={t(`library.types.${ty}`)} selected={bookFilters.type === ty} onPress={() => setBookFilters({ ...bookFilters, type: ty })} />)}
          </ScrollView>
          {(bookFilters.gradeId || bookFilters.subjectId) ? (
            <View style={styles.active}>
              {bookFilters.gradeId ? <Chip small label={grades.find(g => g.id === bookFilters.gradeId)?.name ?? ''} icon="close" onPress={() => setBookFilters({ ...bookFilters, gradeId: undefined })} /> : null}
              {bookFilters.subjectId ? <Chip small label={subjects.find(s => s.id === bookFilters.subjectId)?.name ?? ''} icon="close" onPress={() => setBookFilters({ ...bookFilters, subjectId: undefined })} /> : null}
            </View>
          ) : null}
          {books.data ? <Text role="caption" tone="tertiary" tabular>{books.data.pages[0].meta.total} {t('common.pages') === '' ? '' : ''}{t('search.books')}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        books.isLoading ? <View style={styles.skeletons}><CardSkeleton /><CardSkeleton /></View>
          : books.error ? <ErrorState error={books.error} onRetry={() => books.refetch()} />
          : <EmptyState icon="book" title={t('library.empty')} body={t('library.emptyHint')} actionLabel={t('common.reset')} onAction={reset} />
      }
      ListFooterComponent={books.isFetchingNextPage ? <View style={styles.skeletons}><CardSkeleton /><CardSkeleton /></View> : <View style={styles.bottom} />}
    />
  );

  const mineBooks: BookCardData[] = useMemo(() => {
    const owned = purchases.data?.books ?? [];
    return owned.map(b => items.find(x => x.id === b.id) ?? null).filter(Boolean) as BookCardData[];
  }, [purchases.data, items]);
  const mine = (
    <ScrollView contentContainerStyle={styles.mine}>
      {purchases.isLoading ? <CardSkeleton /> : purchases.error ? <ErrorState error={purchases.error} onRetry={() => purchases.refetch()} />
        : !purchases.data?.books.length ? <EmptyState icon="library" title={t('library.myLibraryEmpty')} actionLabel={t('library.explore')} onAction={() => setTab('explore')} />
        : purchases.data.books.map(b => {
          const card = mineBooks.find(x => x.id === b.id);
          return (
            <View key={b.id} style={styles.mineRow}>
              <View style={styles.flex}>
                <Text role="bodyMedium" numberOfLines={2}>{b.title}</Text>
                <Text role="caption" tone="tertiary" tabular>{b.purchasedAt.slice(0, 10)}</Text>
              </View>
              <Button label={t('library.read')} size="sm" icon="book" onPress={() => router.push(`/book/${b.id}/read`)} />
              {card ? null : <Button label={t('common.details')} size="sm" variant="ghost" onPress={() => router.push(`/book/${b.id}`)} />}
            </View>
          );
        })}
    </ScrollView>
  );

  return (
    <Screen title={t('library.title')} right={<HeaderActions />} scroll={false} padded={false}>
      <View style={styles.search}>
        <SearchInput value={q} onChangeText={setQ} placeholder={t('library.searchPlaceholder')} onClear={() => setQ('')} onFilter={() => setSheet(true)} activeFilters={activeCount} returnKeyType="search" />
      </View>
      <View style={styles.tabs}><Tabs items={[{ key: 'explore', label: t('library.title') }, { key: 'mine', label: t('library.myLibrary'), count: purchases.data?.books.length || undefined }]} value={tab} onChange={setTab} /></View>
      {tab === 'explore' ? explore : mine}

      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title={t('common.filters')}
        footer={<View style={styles.sheetFoot}><Button label={t('common.reset')} variant="secondary" onPress={reset} /><Button label={t('common.apply')} onPress={() => setSheet(false)} style={styles.flex} full /></View>}>
        <View style={styles.sheetBody}>
          <Text role="h3">{t('common.subject')}</Text>
          <View style={styles.wrap}>{subjects.map(s => { const sc = subjectColors[(s.colorKey as SubjectColorKey)] ?? subjectColors.default; const on = bookFilters.subjectId === s.id;
            return <Chip key={s.id} label={s.name} selected={on} color={on ? sc.main : undefined} softColor={on ? sc.soft : undefined} onPress={() => setBookFilters({ ...bookFilters, subjectId: on ? undefined : s.id })} />; })}</View>
          <Text role="h3">{t('common.grade')}</Text>
          <View style={styles.wrap}>{grades.map(g => <Chip key={g.id} label={g.name} selected={bookFilters.gradeId === g.id} onPress={() => setBookFilters({ ...bookFilters, gradeId: bookFilters.gradeId === g.id ? undefined : g.id })} />)}</View>
          <Text role="h3">{t('common.semester')}</Text>
          <View style={styles.wrap}>{(catalog.data?.semesters ?? []).map(s => <Chip key={s.id} label={s.name} selected={bookFilters.semesterId === s.id} onPress={() => setBookFilters({ ...bookFilters, semesterId: bookFilters.semesterId === s.id ? undefined : s.id })} />)}</View>
          <Text role="h3">{t('common.price')}</Text>
          <View style={styles.wrap}>
            <Chip label={t('common.free')} selected={!!bookFilters.free} onPress={() => setBookFilters({ ...bookFilters, free: bookFilters.free ? undefined : true })} />
            <Chip label={`${t('common.rating')} 4+`} selected={bookFilters.minRating === 4} onPress={() => setBookFilters({ ...bookFilters, minRating: bookFilters.minRating === 4 ? undefined : 4 })} />
          </View>
          <Text role="h3">{t('common.sort')}</Text>
          <View style={styles.wrap}>{SORTS.map(s => <Chip key={s} label={t(`library.sort.${s}`)} selected={(bookFilters.sort ?? 'bestselling') === s} onPress={() => setBookFilters({ ...bookFilters, sort: s })} />)}</View>
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  tabs: { paddingHorizontal: spacing[4] },
  head: { gap: spacing[2], paddingTop: spacing[3], paddingBottom: spacing[2] },
  chips: { flexDirection: 'row', gap: spacing[2] },
  active: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  grid: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  cols: { gap: spacing[3] },
  skeletons: { flexDirection: 'row', gap: spacing[3], paddingVertical: spacing[3] },
  bottom: { height: spacing[4] },
  mine: { padding: spacing[4], gap: spacing[3] },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.bg.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border.default, padding: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  sheetBody: { gap: spacing[3] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[2] },
  sheetFoot: { flexDirection: 'row', gap: spacing[2], alignItems: 'center' },
});
