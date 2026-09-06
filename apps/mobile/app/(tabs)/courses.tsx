import { useMemo, useState } from 'react';
import { View, FlatList, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import { Screen, Text, Chip, Tabs, SearchInput, CourseCard, CardSkeleton, EmptyState, ErrorState, HeaderActions } from '@/ui';
import { useCourses, useCatalog, usePurchases } from '@/features/queries';
import { useAuth } from '@/state/auth';
import { useDebounced } from '@/lib/hooks';

const SORTS = ['popular', 'newest', 'rating', 'price_asc'] as const;

/** الدورات المسجّلة: بحث، مادة، ترتيب — و«دوراتي» بتقدّم حقيقي */
export default function Courses() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const [tab, setTab] = useState<'explore' | 'mine'>('explore');
  const [q, setQ] = useState('');
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [gradeId, setGradeId] = useState<number | undefined>(user?.student?.gradeId ?? undefined);
  const [sort, setSort] = useState<typeof SORTS[number]>('popular');
  const dq = useDebounced(q, 300);
  const catalog = useCatalog();
  const courses = useCourses({ q: dq || undefined, subjectId, gradeId, sort });
  const purchases = usePurchases();
  const items = useMemo(() => courses.data?.pages.flatMap(p => p.data) ?? [], [courses.data]);
  const mine = useMemo(() => items.filter(c => c.enrolled), [items]);
  const subjects = catalog.data?.subjects ?? [];

  const list = tab === 'explore' ? items : mine;
  return (
    <Screen title={t('courses.title')} right={<HeaderActions />} scroll={false} padded={false}>
      <View style={styles.search}><SearchInput value={q} onChangeText={setQ} placeholder={t('common.search')} onClear={() => setQ('')} returnKeyType="search" /></View>
      <View style={styles.px}><Tabs value={tab} onChange={setTab} items={[{ key: 'explore', label: t('courses.title') }, { key: 'mine', label: t('library.myCourses'), count: purchases.data?.courses.length || undefined }]} /></View>
      <FlatList
        data={list} keyExtractor={c => String(c.id)} contentContainerStyle={styles.list}
        renderItem={({ item }) => <CourseCard course={item} onPress={() => router.push(`/course/${item.id}`)} />}
        onEndReached={() => tab === 'explore' && courses.hasNextPage && !courses.isFetchingNextPage && courses.fetchNextPage()} onEndReachedThreshold={0.6}
        refreshing={courses.isRefetching} onRefresh={() => courses.refetch()}
        ListHeaderComponent={tab === 'explore' ? (
          <View style={styles.head}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label={t('common.all')} selected={!subjectId} onPress={() => setSubjectId(undefined)} />
              {subjects.map(s => { const sc = subjectColors[(s.colorKey as SubjectColorKey)] ?? subjectColors.default; const on = subjectId === s.id;
                return <Chip key={s.id} label={s.name} selected={on} color={on ? sc.main : undefined} softColor={on ? sc.soft : undefined} onPress={() => setSubjectId(on ? undefined : s.id)} />; })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {gradeId ? <Chip small label={(catalog.data?.grades ?? []).find(g => g.id === gradeId)?.name ?? ''} icon="close" onPress={() => setGradeId(undefined)} /> : null}
              {SORTS.map(s => <Chip key={s} small label={t(`library.sort.${s === 'popular' ? 'bestselling' : s}`)} selected={sort === s} onPress={() => setSort(s)} />)}
            </ScrollView>
            {courses.data ? <Text role="caption" tone="tertiary" tabular>{courses.data.pages[0].meta.total} {t('search.courses')}</Text> : null}
          </View>
        ) : <View style={styles.pt} />}
        ListEmptyComponent={
          courses.isLoading ? <View style={styles.skeletons}><CardSkeleton /><CardSkeleton /></View>
            : courses.error ? <ErrorState error={courses.error} onRetry={() => courses.refetch()} />
            : tab === 'mine' ? <EmptyState icon="courses" title={t('courses.myEmpty')} actionLabel={t('courses.explore')} onAction={() => setTab('explore')} />
            : <EmptyState icon="courses" title={t('courses.empty')} body={t('library.emptyHint')} actionLabel={t('common.reset')} onAction={() => { setSubjectId(undefined); setGradeId(undefined); setQ(''); }} />
        }
        ListFooterComponent={courses.isFetchingNextPage ? <CardSkeleton /> : <View style={styles.pt} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  px: { paddingHorizontal: spacing[4] },
  pt: { paddingTop: spacing[4] },
  head: { gap: spacing[2], paddingTop: spacing[3], paddingBottom: spacing[2] },
  chips: { flexDirection: 'row', gap: spacing[2] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  skeletons: { gap: spacing[3], paddingVertical: spacing[3] },
});
