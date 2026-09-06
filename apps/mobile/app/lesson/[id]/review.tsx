import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import { Screen, Text, Icon, Button, Input, Rating, Avatar, Card, SectionHeader } from '@/ui';
import { useBooking, useSubmitReview } from '@/features/queries';
import { errorMessageKey } from '@/api/client';

/** بعد الحصة: تقييم المعلّم (مقفل بحجز مكتمل)، ثم الملخّص والواجب، ثم «احجز مرة أخرى» */
export default function PostLesson() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = Number(id);
  const q = useBooking(bookingId);
  const submit = useSubmitReview();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const b = q.data;
  const done = submit.isSuccess || (b && !b.needsReview && b.status === 'completed');

  return (
    <Screen onBack={() => router.replace(`/lesson/${bookingId}`)} title={t('lessons.post.rate')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}>
      {b ? (
        <View style={styles.wrap}>
          <View style={styles.teacher}><Avatar name={b.teacher.name} url={b.teacher.avatarUrl} size="xl" verified={b.teacher.verified} /><Text role="h2">{b.teacher.name}</Text><Text role="small" tone="secondary">{b.subject.name} · {b.durationMinutes} {t('common.minutes')}</Text></View>
          {done ? (
            <Card accent><View style={styles.thanks}><Icon name="checkCircle" size={28} color={colors.state.success} /><Text role="h3">{t('lessons.post.thanks')}</Text></View></Card>
          ) : (
            <Card>
              <View style={styles.stars}><Rating value={rating} onChange={setRating} size={38} showValue={false} /></View>
              <Input value={comment} onChangeText={setComment} placeholder={t('lessons.post.comment')} multiline numberOfLines={3} maxLength={1500} />
              {submit.error ? <Text role="small" tone="danger">{t(errorMessageKey(submit.error))}</Text> : null}
              <Button label={t('lessons.post.submit')} full disabled={rating === 0} loading={submit.isPending} style={styles.mt} onPress={() => submit.mutate({ targetType: 'teacher', targetId: b.teacher.id, rating, comment: comment.trim() || null, gateRef: bookingId })} />
            </Card>
          )}
          {b.notes ? (
            <Card>
              <SectionHeader title={t('lessons.post.summary')} />
              {b.notes.summary ? <Text role="body" tone="secondary" style={styles.para}>{b.notes.summary}</Text> : null}
              {b.notes.homework ? <View style={styles.hw}><Text role="caption" tone="brand">{t('lessons.post.homework')}</Text><Text role="body">{b.notes.homework}</Text></View> : null}
            </Card>
          ) : <Text role="caption" tone="tertiary" center>{t('lessons.post.summary')}: —</Text>}
          <Button label={t('lessons.post.bookAgain')} icon="calendar" variant="secondary" full onPress={() => router.replace(`/teacher/${b.teacher.id}/book`)} />
          <Button label={t('common.done')} variant="ghost" full onPress={() => router.replace('/(tabs)/lessons')} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[4], paddingTop: spacing[2] },
  teacher: { alignItems: 'center', gap: spacing[2] },
  stars: { alignItems: 'center', marginBottom: spacing[3] },
  mt: { marginTop: spacing[3] },
  thanks: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2] },
  para: { lineHeight: 24 },
  hw: { marginTop: spacing[3], padding: spacing[3], backgroundColor: colors.brand.primarySoft, borderRadius: radius.md, gap: 4 },
});
