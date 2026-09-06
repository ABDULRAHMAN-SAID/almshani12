import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, themed } from '@manassah/tokens';
import { Screen, Text, Card, Badge, Button, IconButton, LearnerAvatar, EmptyState } from '@/ui';
import { useReorderLearners } from '@/features/queries';
import { useAuth, useLearners } from '@/state/auth';
import { useUi } from '@/state/ui';
import { errorMessageKey } from '@/api/client';

const MAX_LEARNERS = 6;

/** إدارة المتعلّمين: صفّ لكل متعلّم (نقرة → تعديل، ضغطة مطوّلة → تعيين كنشط)، أسهم ▲/▼ للترتيب، وزرّ إضافة يحترم حدّ الستة */
export default function LearnersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const learners = useLearners();
  const activeId = useAuth(s => s.activeLearnerId);
  const setActiveLearner = useAuth(s => s.setActiveLearner);
  const showToast = useUi(s => s.showToast);
  const reorder = useReorderLearners();

  const move = (index: number, dir: -1 | 1) => {
    const ids = learners.map(l => l.id); const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate(ids);
  };
  const add = () => { if (learners.length >= MAX_LEARNERS) showToast(t('learners.limit')); else router.push('/account/learners/new'); };

  return (
    <Screen onBack={() => router.back()} title={t('learners.title')} footer={<Button label={t('learners.add')} icon="plus" size="lg" full onPress={add} disabled={learners.length >= MAX_LEARNERS} />}>
      <View style={styles.wrap}>
        {learners.length === 0 ? <EmptyState icon="people" title={t('learners.emptyTitle')} body={t('learners.emptyBody')} actionLabel={t('learners.add')} onAction={add} /> : null}
        {learners.map((l, i) => {
          const active = l.id === activeId;
          return (
            <Card key={l.id} accent={active} onPress={() => router.push(`/account/learners/${l.id}`)} onLongPress={() => setActiveLearner(l.id)} accessibilityLabel={l.displayName}>
              <View style={styles.row}>
                <LearnerAvatar learner={l} size={56} badge={false} />
                <View style={styles.flex}>
                  <View style={styles.nameRow}>
                    <Text role="h3" numberOfLines={1} style={styles.name}>{l.displayName}</Text>
                    <Badge label={l.isSelf ? t('learners.self') : t('learners.child')} tone={l.isSelf ? 'info' : 'neutral'} />
                    {active ? <Badge label={t('learners.active')} tone="gold" icon="check" /> : null}
                  </View>
                  <Text role="small" tone="secondary" numberOfLines={2}>{[l.gradeName, l.semesterName].filter(Boolean).join(' · ') || '—'}</Text>
                  {!active ? <Button label={t('learners.setActive')} variant="ghost" size="sm" onPress={() => setActiveLearner(l.id)} style={styles.setActive} /> : null}
                </View>
                {learners.length > 1 ? (
                  <View style={styles.arrows}>
                    <IconButton icon="up" label={t('learners.moveUp')} size={36} variant="soft" color={colors.text.secondary} disabled={i === 0 || reorder.isPending} onPress={() => move(i, -1)} />
                    <IconButton icon="down" label={t('learners.moveDown')} size={36} variant="soft" color={colors.text.secondary} disabled={i === learners.length - 1 || reorder.isPending} onPress={() => move(i, 1)} />
                  </View>
                ) : null}
              </View>
            </Card>
          );
        })}
        {reorder.error ? <Text role="small" tone="danger">{t(errorMessageKey(reorder.error))}</Text> : null}
        <Text role="caption" tone="tertiary" center>{t('learners.limit')}</Text>
      </View>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], flexWrap: 'wrap' },
  name: { flexShrink: 1 },
  setActive: { alignSelf: 'flex-start', marginTop: spacing[1], marginStart: -spacing[3] },
  arrows: { gap: spacing[1] },
}));
