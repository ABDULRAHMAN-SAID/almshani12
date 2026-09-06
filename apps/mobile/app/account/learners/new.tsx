import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { Learner, LearnerUpsert } from '@manassah/shared';
import { Screen, Button, Dialog, LearnerForm } from '@/ui';
import { useCreateLearner } from '@/features/queries';
import { useAuth, useLearners } from '@/state/auth';

/** إضافة متعلّم: نموذج الإضافة، وبعد الحفظ (إن لم يكن الأول) سؤال «اجعله المتعلّم النشط؟» */
export default function NewLearner() {
  const { t } = useTranslation();
  const router = useRouter();
  const learners = useLearners();
  const setActiveLearner = useAuth(s => s.setActiveLearner);
  const create = useCreateLearner();
  const [created, setCreated] = useState<Learner | null>(null);

  const submit = (input: LearnerUpsert) => {
    const before = new Set(learners.map(l => l.id));
    create.mutate(input, {
      onSuccess: (u) => {
        const fresh = u.learners.find(l => !before.has(l.id)) ?? null;
        if (fresh && u.learners.length > 1) setCreated(fresh); else router.back();
      },
    });
  };
  const close = (activate: boolean) => { if (activate && created) setActiveLearner(created.id); setCreated(null); router.back(); };

  return (
    <Screen onBack={() => router.back()} title={t('learners.add')}>
      {/* خيار «أنا / ابن» يبقى ظاهراً دائماً عند الإضافة: الطالب قد يضيف صفّاً ثانياً لنفسه (D1)؛ الافتراضي «أنا» ما لم يكن للحساب أبناء */}
      <LearnerForm mode="add" showSelfToggle isSelf={!learners.some(l => !l.isSelf)} onSubmit={submit} busy={create.isPending} error={create.error} submitLabel={t('common.save')} />
      <Dialog visible={!!created} onClose={() => close(false)} title={t('learners.makeActive')} body={created?.displayName ?? ''}
        actions={<><Button label={t('common.no')} variant="secondary" onPress={() => close(false)} /><Button label={t('common.yes')} onPress={() => close(true)} /></>} />
    </Screen>
  );
}
