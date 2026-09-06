import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, themed } from '@manassah/tokens';
import type { LearnerUpsert } from '@manassah/shared';
import { Screen, Text, Button, Card, Icon, LearnerForm, BottomSheet } from '@/ui';
import { useCreateLearner, useUpdateProfile } from '@/features/queries';
import { useAuth } from '@/state/auth';

/**
 * الإعداد الأوّلي على خطوتين: (١) من سيستخدم الحساب؟ طالب (متعلّم ذاتي) أو وليّ أمر (أبناء) → (٢) نموذج أول متعلّم.
 * وليّ الأمر يُسأل بعد كل ابن «أضف ابناً آخر؟». لو كان للحساب متعلّمون أصلاً (فُتحت من الإعدادات) يظهر نموذج الإضافة مباشرة.
 */
export default function Setup() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const create = useCreateLearner();
  const profile = useUpdateProfile();
  const hasLearners = (user?.learners.length ?? 0) > 0;
  // هل فُتحت الشاشة من الإعداد الأوّلي؟ تُثبَّت عند الفتح لأن أول متعلّم يجعل hasLearners صحيحاً قبل أن ينتهي الإعداد
  const [fromOnboarding] = useState(!hasLearners);
  // من الإعدادات (لديه متعلّمون): الافتراضي «أنا» ما لم يكن للحساب أبناء؛ من الإعداد الأوّلي يقرّره سؤال «من سيستخدم الحساب؟»
  const [isSelf, setIsSelf] = useState<boolean | null>(hasLearners ? !user!.learners.some(l => !l.isSelf) : null);
  const [askAnother, setAskAnother] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const mode: 'first' | 'add' = hasLearners ? 'add' : 'first';

  const submit = (input: LearnerUpsert) => {
    create.mutate(input, {
      onSuccess: () => {
        // «أنا طالب» على حساب بلا اسم بعد: اسم المتعلّم الذاتي هو اسم الحساب (الخادم لا يعكسه تلقائياً)
        if (input.isSelf && !user?.displayName) profile.mutate({ displayName: input.displayName });
        if (mode === 'first' && !input.isSelf) setAskAnother(true);   // وليّ أمر: ربما لديه ابن آخر
        else router.replace(fromOnboarding ? '/(tabs)' : '/account/learners');
      },
    });
  };
  const addAnother = () => { setAskAnother(false); setFormKey(k => k + 1); create.reset(); };
  const finish = () => { setAskAnother(false); router.replace('/(tabs)'); };

  if (isSelf === null) {
    return (
      <Screen title={t('onboarding.setupTitle')}>
        <View style={styles.wrap}>
          <Text role="h1">{t('onboarding.whoUses')}</Text>
          <Card onPress={() => setIsSelf(true)} style={styles.choice} accessibilityLabel={t('onboarding.meStudent')}>
            <View style={[styles.choiceIcon, { backgroundColor: colors.brand.primarySoft }]}><Icon name="schoolSolid" size={30} color={colors.brand.primary} /></View>
            <View style={styles.flex}><Text role="h2">{t('onboarding.meStudent')}</Text><Text role="small" tone="secondary">{t('onboarding.studentHint')}</Text></View>
            <Icon name="forward" size={20} color={colors.text.tertiary} />
          </Card>
          <Card onPress={() => setIsSelf(false)} style={styles.choice} accessibilityLabel={t('onboarding.meParent')}>
            <View style={[styles.choiceIcon, { backgroundColor: colors.brand.greenSoft }]}><Icon name="people" size={30} color={colors.brand.green} /></View>
            <View style={styles.flex}><Text role="h2">{t('onboarding.meParent')}</Text><Text role="small" tone="secondary">{t('onboarding.parentHint')}</Text></View>
            <Icon name="forward" size={20} color={colors.text.tertiary} />
          </Card>
          <Text role="caption" tone="tertiary">{t('auth.setupLater')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={mode === 'add' ? t('learners.add') : t('onboarding.setupTitle')} onBack={() => (!fromOnboarding ? router.back() : formKey === 0 ? setIsSelf(null) : finish())}>
      <LearnerForm key={formKey} mode={mode} showSelfToggle={hasLearners} isSelf={isSelf}
        defaultName={isSelf && formKey === 0 ? user?.displayName ?? '' : ''} onSubmit={submit} busy={create.isPending} error={create.error}
        submitLabel={mode === 'add' ? t('learners.add') : t('onboarding.finish')} />
      <BottomSheet visible={askAnother} onClose={finish} title={t('learners.addAnother')}
        footer={<View style={styles.sheetFoot}><Button label={t('learners.later')} variant="secondary" onPress={finish} /><Button label={t('learners.add')} icon="plus" onPress={addAnother} style={styles.flex} full /></View>}>
        <Text role="body" tone="secondary">{t('learners.emptyBody')}</Text>
      </BottomSheet>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { gap: spacing[4], paddingTop: spacing[2] },
  flex: { flex: 1, minWidth: 0 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  choiceIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  sheetFoot: { flexDirection: 'row', gap: spacing[2], alignItems: 'center' },
}));
