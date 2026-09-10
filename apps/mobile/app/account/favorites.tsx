import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing } from '@manassah/tokens';
import { Screen, Tabs, BookCard, CourseCard, TeacherCard, EmptyState } from '@/ui';
import { useFavorites } from '@/features/queries';
import { safeBack } from '@/lib/session';

export default function Favorites() {
  const { t } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<'books' | 'courses' | 'teachers'>('books');
  const q = useFavorites();
  const d = q.data;
  const empty = <EmptyState icon="heart" title={t('account.noFavorites')} actionLabel={t('library.explore')} onAction={() => router.replace('/(tabs)/library')} />;
  return (
    <Screen onBack={() => safeBack(router)} title={t('account.favorites')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
      <Tabs value={tab} onChange={setTab} items={[{ key: 'books', label: t('search.books'), count: d?.books.length }, { key: 'courses', label: t('search.courses'), count: d?.courses.length }, { key: 'teachers', label: t('search.teachers'), count: d?.teachers.length }]} />
      <View style={styles.list}>
        {tab === 'books' ? (d?.books.length ? d.books.map(b => <BookCard key={b.id} book={b} compact onPress={() => router.push(`/book/${b.id}`)} />) : empty) : null}
        {tab === 'courses' ? (d?.courses.length ? d.courses.map(c => <CourseCard key={c.id} course={c} onPress={() => router.push(`/course/${c.id}`)} />) : empty) : null}
        {tab === 'teachers' ? (d?.teachers.length ? d.teachers.map(x => <TeacherCard key={x.id} teacher={x} onPress={() => router.push(`/teacher/${x.id}`)} onBook={() => router.push(`/teacher/${x.id}/book`)} />) : empty) : null}
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({ list: { gap: spacing[3], paddingTop: spacing[4] } });
