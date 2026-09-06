import { useEffect, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import { Screen, Text, Chip, Button, SearchInput, TeacherCard, BottomSheet, CardSkeleton, EmptyState, ErrorState } from '@/ui';
import { useTeachers, useCatalog } from '@/features/queries';
import { useUi } from '@/state/ui';
import { useAuth, useActiveLearner } from '@/state/auth';
import { useDebounced } from '@/lib/hooks';

const SORTS = ['recommended', 'rating', 'price_asc', 'soonest'] as const;
const PRICES = [3, 5, 8];

/** البحث عن معلّم: المادة، الصف، السعر، التقييم، متاح الآن، النوع، الجنس، اللغة، الخبرة، الترتيب */
export default function Teachers() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; subjectId?: string }>();
  const learner = useActiveLearner();
  const activeLearnerId = useAuth(s => s.activeLearnerId);
  const { teacherFilters: f, setTeacherFilters: setF } = useUi();
  const [q, setQ] = useState(params.q ?? '');
  const [sheet, setSheet] = useState(false);
  const dq = useDebounced(q, 300);
  const catalog = useCatalog();
  // صف المتعلّم النشط فلتراً أوّلياً — ويُعاد ضبطه عند تبديل المتعلّم
  useEffect(() => { setF({ ...useUi.getState().teacherFilters, gradeId: learner?.gradeId ?? undefined, ...(params.subjectId ? { subjectId: Number(params.subjectId) } : {}) }); }, [params.subjectId, activeLearnerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const teachers = useTeachers({ ...f, q: dq || undefined });
  const items = useMemo(() => teachers.data?.pages.flatMap(p => p.data) ?? [], [teachers.data]);
  const subjects = catalog.data?.subjects ?? [], grades = catalog.data?.grades ?? [];
  const active = ['subjectId', 'gradeId', 'maxPrice', 'minRating', 'availableNow', 'mode', 'gender', 'language', 'minYearsExp'].filter(k => (f as Record<string, unknown>)[k] != null).length;
  const reset = () => setF({ gradeId: learner?.gradeId ?? undefined });
  const toggle = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: f[k] === v ? undefined : v });

  return (
    <Screen onBack={() => router.back()} title={t('teachers.title')} scroll={false} padded={false}>
      <View style={styles.px}><SearchInput value={q} onChangeText={setQ} placeholder={t('teachers.searchPlaceholder')} onClear={() => setQ('')} onFilter={() => setSheet(true)} activeFilters={active} returnKeyType="search" /></View>
      <FlatList
        data={items} keyExtractor={x => String(x.id)} contentContainerStyle={styles.list}
        renderItem={({ item }) => <TeacherCard teacher={item} onPress={() => router.push(`/teacher/${item.id}`)} onBook={() => router.push(`/teacher/${item.id}/book`)} />}
        onEndReached={() => teachers.hasNextPage && !teachers.isFetchingNextPage && teachers.fetchNextPage()} onEndReachedThreshold={0.6}
        refreshing={teachers.isRefetching} onRefresh={() => teachers.refetch()}
        ListHeaderComponent={
          <View style={styles.head}>
            <FlatList horizontal showsHorizontalScrollIndicator={false} data={[{ id: 0, name: t('common.all'), colorKey: 'default' }, ...subjects]} keyExtractor={s => String(s.id)} contentContainerStyle={styles.chips}
              renderItem={({ item: s }) => { const sc = subjectColors[(s.colorKey as SubjectColorKey)] ?? subjectColors.default; const on = s.id === 0 ? !f.subjectId : f.subjectId === s.id;
                return <Chip label={s.name} selected={on} color={on && s.id ? sc.main : undefined} softColor={on && s.id ? sc.soft : undefined} onPress={() => setF({ ...f, subjectId: s.id || undefined })} />; }} />
            <View style={styles.chipsWrap}>
              <Chip small label={t('teachers.availableNow')} selected={!!f.availableNow} onPress={() => toggle('availableNow', true)} />
              {f.gradeId ? <Chip small label={grades.find(g => g.id === f.gradeId)?.name ?? ''} icon="close" onPress={() => setF({ ...f, gradeId: undefined })} /> : null}
              {teachers.data ? <Text role="caption" tone="tertiary" tabular style={styles.count}>{teachers.data.pages[0].meta.total} {t('search.teachers')}</Text> : null}
            </View>
          </View>
        }
        ListEmptyComponent={teachers.isLoading ? <View style={styles.sk}><CardSkeleton cover={false} /><CardSkeleton cover={false} /></View>
          : teachers.error ? <ErrorState error={teachers.error} onRetry={() => teachers.refetch()} />
          : <EmptyState icon="teacher" title={t('teachers.empty')} body={t('teachers.emptyHint')} actionLabel={t('common.reset')} onAction={reset} />}
        ListFooterComponent={teachers.isFetchingNextPage ? <CardSkeleton cover={false} /> : <View style={styles.pt} />}
      />
      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title={t('common.filters')}
        footer={<View style={styles.foot}><Button label={t('common.reset')} variant="secondary" onPress={reset} /><Button label={t('common.apply')} onPress={() => setSheet(false)} style={styles.flex} full /></View>}>
        <View style={styles.body}>
          <Text role="h3">{t('common.grade')}</Text>
          <View style={styles.wrap}>{grades.map(g => <Chip key={g.id} label={g.name} selected={f.gradeId === g.id} onPress={() => toggle('gradeId', g.id)} />)}</View>
          <Text role="h3">{t('common.price')} ({t('teachers.lesson60')})</Text>
          <View style={styles.wrap}>{PRICES.map(p => <Chip key={p} label={`≤ ${p} ر.ع`} selected={f.maxPrice === p} onPress={() => toggle('maxPrice', p)} />)}</View>
          <Text role="h3">{t('common.rating')}</Text>
          <View style={styles.wrap}><Chip label="4+" icon="star" selected={f.minRating === 4} onPress={() => toggle('minRating', 4)} /><Chip label="4.5+" icon="star" selected={f.minRating === 4.5} onPress={() => toggle('minRating', 4.5)} /></View>
          <Text role="h3">{t('booking.mode')}</Text>
          <View style={styles.wrap}><Chip label={t('teachers.individual')} selected={f.mode === 'individual'} onPress={() => toggle('mode', 'individual')} /><Chip label={t('teachers.group')} selected={f.mode === 'group'} onPress={() => toggle('mode', 'group')} /></View>
          <Text role="h3">{t('teachers.gender')}</Text>
          <View style={styles.wrap}><Chip label={t('teachers.male')} selected={f.gender === 'male'} onPress={() => toggle('gender', 'male')} /><Chip label={t('teachers.female')} selected={f.gender === 'female'} onPress={() => toggle('gender', 'female')} /></View>
          <Text role="h3">{t('teachers.language')}</Text>
          <View style={styles.wrap}><Chip label="العربية" selected={f.language === 'ar'} onPress={() => toggle('language', 'ar')} /><Chip label="English" selected={f.language === 'en'} onPress={() => toggle('language', 'en')} /></View>
          <Text role="h3">{t('teachers.experience', { n: '' }).trim()}</Text>
          <View style={styles.wrap}>{[3, 5, 10].map(n => <Chip key={n} label={`${n}+`} selected={f.minYearsExp === n} onPress={() => toggle('minYearsExp', n)} />)}</View>
          <Text role="h3">{t('common.sort')}</Text>
          <View style={styles.wrap}>{SORTS.map(s => <Chip key={s} label={s === 'recommended' ? t('home.recommendedTeachers') : s === 'soonest' ? t('teachers.nextSlot') : t(`library.sort.${s}`)} selected={(f.sort ?? 'recommended') === s} onPress={() => setF({ ...f, sort: s })} />)}</View>
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  px: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  head: { gap: spacing[2], paddingBottom: spacing[1] },
  chips: { gap: spacing[2] },
  chipsWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  count: { marginStart: 'auto' },
  sk: { gap: spacing[3] },
  pt: { paddingTop: spacing[4] },
  foot: { flexDirection: 'row', gap: spacing[2], alignItems: 'center' },
  flex: { flex: 1 },
  body: { gap: spacing[3] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[2] },
});
