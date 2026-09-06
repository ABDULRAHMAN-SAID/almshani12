import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import type { z } from 'zod';
import type { ReviewItem, CreateReview } from '@manassah/shared';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Rating } from './Rating';
import { Button } from './Button';
import { Input } from './Input';
import { BottomSheet } from './BottomSheet';
import { useSubmitReview } from '@/features/queries';
import { errorMessageKey } from '@/api/client';
import { formatDayShort } from '@/lib/format';

type Item = z.infer<typeof ReviewItem>;

/** قائمة تقييمات حقيقية — لا تُعرض إن كانت فارغة، ولا أرقام وهمية */
export function ReviewList({ items, avg, count }: { items: Item[]; avg: number; count: number }) {
  const { t } = useTranslation();
  if (!items.length) return <Text role="small" tone="tertiary">{t('common.reviews')}: 0</Text>;
  return (
    <View style={styles.list}>
      <View style={styles.summary}><Text role="display" tabular>{avg.toFixed(1)}</Text><View><Rating value={avg} size={16} showValue={false} /><Text role="caption" tone="secondary" tabular>{count} {t('common.reviews')}</Text></View></View>
      {items.map(r => (
        <View key={r.id} style={styles.item}>
          <View style={styles.head}>
            <Avatar name={r.userName} url={r.userAvatarUrl} size="sm" />
            <View style={styles.flex}><Text role="bodyMedium" numberOfLines={1}>{r.userName}</Text><Text role="caption" tone="tertiary" tabular>{formatDayShort(r.createdAt)}</Text></View>
            <Rating value={r.rating} size={12} showValue={false} />
          </View>
          {r.comment ? <Text role="small" tone="secondary">{r.comment}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** نموذج تقييم — يظهر فقط عندما يسمح الخادم (canReview) */
export function ReviewSheet({ visible, onClose, targetType, targetId, gateRef, onDone }: { visible: boolean; onClose: () => void; targetType: z.infer<typeof CreateReview>['targetType']; targetId: number; gateRef?: number | null; onDone?: () => void }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const submit = useSubmitReview();
  const send = () => submit.mutate({ targetType, targetId, rating, comment: comment.trim() || null, gateRef: gateRef ?? null }, { onSuccess: () => { onDone?.(); onClose(); } });
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('book.writeReview')}
      footer={<Button label={t('lessons.post.submit')} onPress={send} loading={submit.isPending} disabled={rating === 0} full />}>
      <View style={styles.form}>
        <View style={styles.center}><Rating value={rating} onChange={setRating} size={34} showValue={false} /></View>
        <Input value={comment} onChangeText={setComment} placeholder={t('lessons.post.comment')} multiline numberOfLines={4} maxLength={1500} />
        {submit.error ? <Text role="small" tone="danger">{t(errorMessageKey(submit.error))}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing[3] },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  item: { backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.default, padding: spacing[3], gap: spacing[2] },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  flex: { flex: 1, minWidth: 0 },
  form: { gap: spacing[4] },
  center: { alignItems: 'center' },
});
