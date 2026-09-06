import { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import { Screen, Text, Button, Input, Chip } from '@/ui';
import { useCatalog, useStudentSetup } from '@/features/queries';
import { useAuth } from '@/state/auth';
import { errorMessageKey } from '@/api/client';

/** إعداد الطالب: الاسم، الصف، الفصل، المواد — تُخصَّص الرئيسية بناءً عليها */
export default function Setup() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const catalog = useCatalog();
  const setup = useStudentSetup();
  const [name, setName] = useState(user?.displayName ?? '');
  const [gradeId, setGradeId] = useState<number | null>(user?.student?.gradeId ?? null);
  const [semesterId, setSemesterId] = useState<number | null>(user?.student?.semesterId ?? null);
  const [subjects, setSubjects] = useState<number[]>(user?.student?.subjectIds ?? []);

  const curriculum = catalog.data?.curriculums[0];
  const grades = useMemo(() => (catalog.data?.grades ?? []).filter(g => g.curriculumId === curriculum?.id), [catalog.data, curriculum]);
  const semesters = useMemo(() => (catalog.data?.semesters ?? []).filter(s => s.curriculumId === curriculum?.id), [catalog.data, curriculum]);
  const subjectList = useMemo(() => (catalog.data?.subjects ?? []).filter(s => s.curriculumId === curriculum?.id), [catalog.data, curriculum]);

  const canSubmit = name.trim().length >= 2 && !!gradeId && !!semesterId && subjects.length > 0 && !!curriculum;
  const submit = () => {
    if (!canSubmit || !curriculum) return;
    setup.mutate({ displayName: name.trim(), curriculumId: curriculum.id, gradeId: gradeId!, semesterId: semesterId!, subjectIds: subjects },
      { onSuccess: () => router.replace('/(tabs)') });
  };

  return (
    <Screen title={t('onboarding.setupTitle')} loading={catalog.isLoading} error={catalog.error} onRetry={() => catalog.refetch()}
      footer={<Button label={t('onboarding.finish')} onPress={submit} loading={setup.isPending} disabled={!canSubmit} size="lg" full />}>
      <View style={styles.wrap}>
        <View style={styles.block}>
          <Text role="h3">{t('onboarding.yourName')}</Text>
          <Input value={name} onChangeText={setName} placeholder={t('onboarding.yourName')} autoCapitalize="words" textContentType="name" />
        </View>
        <View style={styles.block}>
          <Text role="h3">{t('onboarding.system')}</Text>
          <Text role="small" tone="secondary">{catalog.data?.countries[0]?.name} · {curriculum?.name}</Text>
        </View>
        <View style={styles.block}>
          <Text role="h3">{t('onboarding.chooseGrade')}</Text>
          <View style={styles.chips}>{grades.map(g => <Chip key={g.id} label={g.name} selected={gradeId === g.id} onPress={() => setGradeId(g.id)} />)}</View>
        </View>
        <View style={styles.block}>
          <Text role="h3">{t('onboarding.chooseSemester')}</Text>
          <View style={styles.chips}>{semesters.map(s => <Chip key={s.id} label={s.name} selected={semesterId === s.id} onPress={() => setSemesterId(s.id)} />)}</View>
        </View>
        <View style={styles.block}>
          <Text role="h3">{t('onboarding.chooseSubjects')}</Text>
          <View style={styles.chips}>
            {subjectList.map(s => {
              const sc = subjectColors[(s.colorKey as SubjectColorKey)] ?? subjectColors.default;
              const on = subjects.includes(s.id);
              return <Chip key={s.id} label={s.name} selected={on} color={on ? sc.main : undefined} softColor={on ? sc.soft : undefined}
                onPress={() => setSubjects(list => on ? list.filter(x => x !== s.id) : [...list, s.id])} />;
            })}
          </View>
        </View>
        {setup.error ? <Text role="small" tone="danger">{t(errorMessageKey(setup.error))}</Text> : null}
        <Text role="caption" tone="tertiary">{t('auth.setupLater')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[6], paddingTop: spacing[2] },
  block: { gap: spacing[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  hint: { color: colors.text.tertiary },
});
