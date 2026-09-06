import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@manassah/tokens';
import { Screen, Text, Chip, SearchInput, BookCard, TeacherCard, CourseCard, SectionHeader, EmptyState, ErrorState, RowSkeleton, Icon } from '@/ui';
import { useSearch } from '@/features/queries';
import { useUi } from '@/state/ui';
import { useDebounced } from '@/lib/hooks';

/** بحث موحّد بتطبيع عربي: كتب، معلّمون، دورات، دروس المنهج */
export default function Search() {
  const { t } = useTranslation();
  const router = useRouter();
  const { recentSearches, pushSearch, clearSearches } = useUi();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 350);
  const res = useSearch(dq);
  const total = res.data ? res.data.books.length + res.data.teachers.length + res.data.courses.length + res.data.lessons.length : 0;
  const commit = (v: string) => { setQ(v); if (v.trim().length >= 2) pushSearch(v.trim()); };

  return (
    <Screen onBack={() => router.back()} title={t('search.title')} scroll={false} padded={false}>
      <View style={styles.px}>
        <SearchInput value={q} onChangeText={setQ} placeholder={t('search.placeholder')} onClear={() => setQ('')} autoFocus returnKeyType="search" onSubmitEditing={() => commit(q)} />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {dq.length < 2 ? (
          <View style={styles.px}>
            {recentSearches.length ? (
              <View>
                <SectionHeader title={t('search.recent')} onSeeAll={clearSearches} seeAllLabel={t('search.clear')} />
                <View style={styles.chips}>{recentSearches.map(s => <Chip key={s} label={s} icon="clock" onPress={() => commit(s)} />)}</View>
              </View>
            ) : <Text role="small" tone="tertiary" center style={styles.hint}>{t('search.minChars')}</Text>}
          </View>
        ) : res.isLoading ? (
          <View style={styles.px}><RowSkeleton /><RowSkeleton /><RowSkeleton /></View>
        ) : res.error ? (
          <ErrorState error={res.error} onRetry={() => res.refetch()} />
        ) : total === 0 ? (
          <EmptyState icon="search" title={t('search.noResults', { q: dq })} body={t('search.noResultsHint')} />
        ) : (
          <View style={styles.results}>
            {res.data!.teachers.length ? (
              <View style={styles.px}>
                <SectionHeader title={t('search.teachers')} onSeeAll={() => router.push({ pathname: '/teachers', params: { q: dq } })} />
                <View style={styles.list}>{res.data!.teachers.map(tc => <TeacherCard key={tc.id} teacher={tc} compact onPress={() => router.push(`/teacher/${tc.id}`)} onBook={() => router.push(`/teacher/${tc.id}/book`)} />)}</View>
              </View>
            ) : null}
            {res.data!.books.length ? (
              <View style={styles.px}>
                <SectionHeader title={t('search.books')} onSeeAll={() => router.push({ pathname: '/(tabs)/library', params: { q: dq } })} />
                <View style={styles.list}>{res.data!.books.map(b => <BookCard key={b.id} book={b} compact onPress={() => router.push(`/book/${b.id}`)} />)}</View>
              </View>
            ) : null}
            {res.data!.courses.length ? (
              <View style={styles.px}>
                <SectionHeader title={t('search.courses')} />
                <View style={styles.list}>{res.data!.courses.map(c => <CourseCard key={c.id} course={c} onPress={() => router.push(`/course/${c.id}`)} />)}</View>
              </View>
            ) : null}
            {res.data!.lessons.length ? (
              <View style={styles.px}>
                <SectionHeader title={t('search.lessons')} />
                <View style={styles.list}>{res.data!.lessons.map(l => (
                  <Pressable key={l.id} style={styles.lesson} onPress={() => router.push({ pathname: '/(tabs)/library', params: { q: l.unitTitle } })} accessibilityRole="button">
                    <Icon name="list" size={18} color={colors.text.secondary} />
                    <View style={styles.flex}>
                      <Text role="bodyMedium" numberOfLines={1}>{l.title}</Text>
                      <Text role="caption" tone="secondary" numberOfLines={1}>{l.subjectName} · {l.unitTitle}</Text>
                    </View>
                  </Pressable>
                ))}</View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  px: { paddingHorizontal: spacing[4] },
  body: { paddingVertical: spacing[3], paddingBottom: spacing[8] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  hint: { marginTop: spacing[6] },
  results: { gap: spacing[5] },
  list: { gap: spacing[3] },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: colors.bg.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border.default, padding: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
});
