import { useEffect, useMemo, useState } from 'react';
import { View, FlatList, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, subjectColors, subjectIcons, type SubjectColorKey, themed } from '@manassah/tokens';
import { BookType, type BookCard as BookCardData } from '@manassah/shared';
import { Screen, Text, Chip, Button, Tabs, SearchInput, BookCard, BottomSheet, CardSkeleton, EmptyState, ErrorState, HeaderActions, Icon, type IconName } from '@/ui';
import { useBooks, useCatalog, usePurchases } from '@/features/queries';
import { useAuth, useActiveLearner } from '@/state/auth';
import { useUi } from '@/state/ui';
import { useDebounced } from '@/lib/hooks';
import { formatDayShort } from '@/lib/format';

const TYPES = BookType.options;
const SORTS = ['bestselling', 'newest', 'rating', 'price_asc', 'price_desc'] as const;
const subjKey = (k?: string | null) => ((k && k in subjectColors ? k : 'default') as SubjectColorKey);

/** المكتبة: بحث كبير → المواد كبلاطات ملوّنة → نوع الكتاب → شبكة كتب. الفلاتر الدقيقة في ورقة سفلية */
export default function Library() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; subjectId?: string }>();
  const learner = useActiveLearner();
  const activeLearnerId = useAuth(s => s.activeLearnerId);
  const { bookFilters, setBookFilters } = useUi();
  const [tab, setTab] = useState<'explore' | 'mine'>('explore');
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState(false);
  const dq = useDebounced(q, 300);
  const catalog = useCatalog();

  // فلتر أوّلي: صف المتعلّم النشط (يُعاد ضبطه عند تبديل المتعلّم) + ما جاء من الرابط
  useEffect(() => {
    setBookFilters({ ...useUi.getState().bookFilters, gradeId: learner?.gradeId ?? undefined, ...(params.type ? { type: params.type as never } : {}), ...(params.subjectId ? { subjectId: Number(params.subjectId) } : {}) });
  }, [params.type, params.subjectId, activeLearnerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters = useMemo(() => ({ ...bookFilters, q: dq || undefined }), [bookFilters, dq]);
  const books = useBooks(filters);
  const purchases = usePurchases();
  const items = useMemo(() => books.data?.pages.flatMap(p => p.data) ?? [], [books.data]);
  const activeCount = ['semesterId', 'free', 'minRating'].filter(k => (bookFilters as Record<string, unknown>)[k] != null).length + (bookFilters.sort && bookFilters.sort !== 'bestselling' ? 1 : 0);
  const grades = catalog.data?.grades ?? [], subjects = catalog.data?.subjects ?? [];
  const reset = () => setBookFilters({ gradeId: learner?.gradeId ?? undefined });
  const gradeName = grades.find(g => g.id === bookFilters.gradeId)?.name;

  const explore = (
    <FlatList
      data={items} keyExtractor={b => String(b.id)} numColumns={2} columnWrapperStyle={styles.cols} contentContainerStyle={styles.grid}
      renderItem={({ item }) => <BookCard book={item} onPress={() => router.push(`/book/${item.id}`)} />}
      onEndReached={() => books.hasNextPage && !books.isFetchingNextPage && books.fetchNextPage()} onEndReachedThreshold={0.6}
      refreshing={books.isRefetching} onRefresh={() => books.refetch()}
      ListHeaderComponent={
        <View style={styles.head}>
          {/* المواد — بلاطات ملوّنة كبيرة، أسهل من قائمة فلاتر */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subjects} style={styles.subjectsWrap}>
            <SubjectTile label={t('common.all')} icon="library" main={colors.text.primary} soft={colors.bg.subtle} selected={!bookFilters.subjectId} onPress={() => setBookFilters({ ...bookFilters, subjectId: undefined })} />
            {subjects.map(s => { const k = subjKey(s.colorKey); const sc = subjectColors[k];
              return <SubjectTile key={s.id} label={s.name} icon={subjectIcons[k] as IconName} main={sc.main} soft={sc.soft} selected={bookFilters.subjectId === s.id} onPress={() => setBookFilters({ ...bookFilters, subjectId: bookFilters.subjectId === s.id ? undefined : s.id })} />; })}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label={t('common.all')} selected={!bookFilters.type} onPress={() => setBookFilters({ ...bookFilters, type: undefined })} />
            {TYPES.map(ty => <Chip key={ty} label={t(`library.types.${ty}`)} selected={bookFilters.type === ty} onPress={() => setBookFilters({ ...bookFilters, type: ty })} />)}
          </ScrollView>
          <View style={styles.metaRow}>
            {books.data ? <Text role="caption" tone="secondary" tabular>{books.data.pages[0].meta.total} {t('search.books')}</Text> : <View />}
            {gradeName ? <Chip small label={gradeName} icon="close" onPress={() => setBookFilters({ ...bookFilters, gradeId: undefined })} /> : null}
          </View>
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
              <View style={styles.mineIcon}><Icon name="bookSolid" size={24} color={colors.brand.green} /></View>
              <View style={styles.flex}>
                <Text role="bodyMedium" numberOfLines={2}>{b.title}</Text>
                <Text role="caption" tone="secondary" tabular>{card ? `${card.subject.name} · ${card.grade.name}` : formatDayShort(b.purchasedAt)}</Text>
              </View>
              <Button label={t('library.read')} icon="book" size="sm" variant="success" onPress={() => router.push(`/book/${b.id}/read`)} />
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

/** بلاطة مادة: دائرة ملوّنة كبيرة بأيقونة المادة واسمها تحتها */
function SubjectTile({ label, icon, main, soft, selected, onPress }: { label: string; icon: IconName; main: string; soft: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [styles.subject, pressed && styles.pressed]}>
      <View style={[styles.subjectCircle, { backgroundColor: selected ? main : soft, borderColor: selected ? main : 'transparent' }]}>
        <Icon name={icon} size={26} color={selected ? '#FFFFFF' : main} />
      </View>
      <Text role="caption" color={selected ? main : colors.text.secondary} numberOfLines={1} center>{label}</Text>
    </Pressable>
  );
}

const styles = themed((c) => StyleSheet.create({
  search: { paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
  tabs: { paddingHorizontal: spacing[4] },
  head: { gap: spacing[3], paddingTop: spacing[3], paddingBottom: spacing[2] },
  subjectsWrap: { marginHorizontal: -spacing[4] },
  subjects: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4] },
  subject: { width: 74, alignItems: 'center', gap: spacing[1] },
  subjectCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  pressed: { opacity: 0.8 },
  chips: { flexDirection: 'row', gap: spacing[2] },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 },
  grid: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  cols: { gap: spacing[3] },
  skeletons: { flexDirection: 'row', gap: spacing[3], paddingVertical: spacing[3] },
  bottom: { height: spacing[4] },
  mine: { padding: spacing[4], gap: spacing[3] },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: c.bg.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border.default, padding: spacing[3] },
  mineIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.brand.greenSoft, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  sheetBody: { gap: spacing[3] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[2] },
  sheetFoot: { flexDirection: 'row', gap: spacing[2], alignItems: 'center' },
}));
