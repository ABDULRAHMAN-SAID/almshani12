import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing } from '@manassah/tokens';
import type { LearnerUpsert } from '@manassah/shared';
import { Screen, Text, Button, Dialog, LearnerForm, EmptyState } from '@/ui';
import { useUpdateLearner, useDeleteLearner } from '@/features/queries';
import { useLearners } from '@/state/auth';
import { errorMessageKey } from '@/api/client';
import { safeBack } from '@/lib/session';

/** تعديل متعلّم + حذف (أرشفة) بتأكيد — أخطاء «لديه حصص قادمة» و«آخر متعلّم» تُعرض بنصّها */
export default function EditLearner() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const learnerId = Number(id);
  const learner = useLearners().find(l => l.id === learnerId);
  const update = useUpdateLearner(learnerId);
  const del = useDeleteLearner(learnerId);
  const [confirm, setConfirm] = useState(false);

  const submit = (input: LearnerUpsert) => { const { isSelf: _ignored, ...patch } = input; update.mutate(patch, { onSuccess: () => router.back() }); };

  return (
    <Screen onBack={() => safeBack(router)} title={t('learners.edit')}>
      {learner ? (
        <View style={styles.wrap}>
          <LearnerForm key={learner.id} mode="edit" initial={learner} showSelfToggle={false} onSubmit={submit} busy={update.isPending} error={update.error} submitLabel={t('common.save')} />
          <Button label={t('learners.delete')} icon="trash" variant="ghost" full onPress={() => setConfirm(true)} />
        </View>
      ) : <EmptyState icon="people" title={t('errors.notFound')} actionLabel={t('common.back')} onAction={() => router.back()} />}
      <Dialog visible={confirm} onClose={() => setConfirm(false)} title={t('learners.delete')} body={t('learners.deleteConfirm')}
        actions={<><Button label={t('common.cancel')} variant="secondary" onPress={() => setConfirm(false)} /><Button label={t('learners.delete')} variant="danger" loading={del.isPending} onPress={() => del.mutate(undefined, { onSuccess: () => { setConfirm(false); router.back(); } })} /></>}>
        {del.error ? <Text role="small" tone="danger">{t(errorMessageKey(del.error))}</Text> : null}
      </Dialog>
    </Screen>
  );
}

const styles = StyleSheet.create({ wrap: { gap: spacing[4], paddingBottom: spacing[6] } });
