import { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing, subjectColors, type SubjectColorKey, themed } from '@manassah/tokens';
import type { Learner, LearnerUpsert } from '@manassah/shared';
import { useCatalog } from '@/features/queries';
import { useLearners } from '@/state/auth';
import { errorMessageKey } from '@/api/client';
import { Text } from './Text';
import { Input } from './Input';
import { Chip } from './Chip';
import { Button } from './Button';
import { RowSkeleton } from './Skeleton';
import { ErrorState } from './States';

export interface LearnerFormProps {
  initial?: Learner;
  /** first: أول متعلّم في الإعداد؛ add: متعلّم إضافي؛ edit: تعديل */
  mode: 'first' | 'add' | 'edit';
  /** يظهر خيار «أنا / ابن-ابنة» — في وضع الإضافة يظهر دائماً (الطالب قد يضيف صفّاً ثانياً لنفسه) */
  showSelfToggle: boolean;
  /** قيمة isSelf الابتدائية، وهي القيمة المُرسلة عند إخفاء الخيار (يقرّرها سؤال «من سيستخدم الحساب؟») */
  isSelf?: boolean;
  /** الاسم الابتدائي عند الإنشاء (اسم الحساب للطالب نفسه) */
  defaultName?: string;
  onSubmit: (input: LearnerUpsert) => void;
  busy: boolean;
  error?: unknown;
  submitLabel: string;
}

/** نموذج المتعلّم: الاسم، الجنس (اختياري)، الصف، الفصل، المواد (≥١)، المدرسة (اختياري) — المنهج الأول من الكتالوج كما في الإعداد */
export function LearnerForm({ initial, mode, showSelfToggle, isSelf: fixedSelf, defaultName, onSubmit, busy, error, submitLabel }: LearnerFormProps) {
  const { t } = useTranslation();
  const catalog = useCatalog();
  const others = useLearners().filter(l => l.id !== initial?.id);
  const selfToggle = showSelfToggle || mode === 'add';   // الإضافة لا تُخفي الخيار أبداً كي لا يتحوّل الصف الثاني للطالب إلى «ابن»
  const [name, setName] = useState(initial?.displayName ?? defaultName ?? '');
  const [gender, setGender] = useState<'male' | 'female' | null>(initial?.gender ?? null);
  const [isSelf, setIsSelf] = useState<boolean>(initial?.isSelf ?? fixedSelf ?? false);
  const [gradeId, setGradeId] = useState<number | null>(initial?.gradeId ?? null);
  const [semesterId, setSemesterId] = useState<number | null>(initial?.semesterId ?? null);
  const [subjects, setSubjects] = useState<number[]>(initial?.subjectIds ?? []);
  const [school, setSchool] = useState(initial?.school ?? '');

  const curriculum = catalog.data?.curriculums[0];
  const grades = useMemo(() => (catalog.data?.grades ?? []).filter(g => g.curriculumId === curriculum?.id), [catalog.data, curriculum]);
  const semesters = useMemo(() => (catalog.data?.semesters ?? []).filter(s => s.curriculumId === curriculum?.id), [catalog.data, curriculum]);
  const subjectList = useMemo(() => (catalog.data?.subjects ?? []).filter(s => s.curriculumId === curriculum?.id), [catalog.data, curriculum]);
  const sameGrade = (id: number) => others.find(l => l.gradeId === id);

  const canSubmit = name.trim().length >= 2 && !!gradeId && !!semesterId && subjects.length > 0 && !!curriculum && !busy;
  const missing = [
    name.trim().length >= 2 ? null : t('onboarding.yourName'),
    gradeId ? null : t('common.grade'),
    semesterId ? null : t('common.semester'),
    subjects.length > 0 ? null : t('common.subject'),
  ].filter(Boolean) as string[];
  const submit = () => {
    if (!canSubmit || !curriculum) return;
    onSubmit({ displayName: name.trim(), gender, isSelf: mode === 'edit' ? undefined : (selfToggle ? isSelf : fixedSelf ?? false), curriculumId: curriculum.id, gradeId: gradeId!, semesterId: semesterId!, subjectIds: subjects, school: school.trim() || null });
  };

  if (catalog.isLoading) return <View style={styles.wrap}><RowSkeleton /><RowSkeleton /></View>;
  if (catalog.error) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;

  return (
    <View style={styles.wrap}>
      <View style={styles.block}>
        <Text role="h3">{isSelf ? t('onboarding.yourName') : t('learners.childName')}</Text>
        <Input value={name} onChangeText={setName} placeholder={isSelf ? t('onboarding.yourName') : t('learners.childName')} autoCapitalize="words" textContentType="name" />
      </View>
      {selfToggle ? (
        <View style={styles.block}>
          <Text role="h3">{t('learners.isSelfToggle')}</Text>
          <View style={styles.chips}>
            <Chip label={t('learners.self')} icon="account" selected={isSelf} onPress={() => setIsSelf(true)} />
            <Chip label={t('learners.child')} icon="people" selected={!isSelf} onPress={() => setIsSelf(false)} />
          </View>
        </View>
      ) : null}
      <View style={styles.block}>
        <Text role="h3">{t('learners.gender')}</Text>
        <View style={styles.chips}>
          <Chip label={t('learners.male')} selected={gender === 'male'} onPress={() => setGender(g => g === 'male' ? null : 'male')} />
          <Chip label={t('learners.female')} selected={gender === 'female'} onPress={() => setGender(g => g === 'female' ? null : 'female')} />
        </View>
      </View>
      <View style={styles.block}>
        <Text role="h3">{t('onboarding.system')}</Text>
        <Text role="small" tone="secondary">{catalog.data?.countries[0]?.name} · {curriculum?.name}</Text>
      </View>
      <View style={styles.block}>
        <Text role="h3">{isSelf ? t('onboarding.chooseGrade') : t('common.grade')}</Text>
        <View style={styles.chips}>{grades.map(g => <Chip key={g.id} label={g.name} selected={gradeId === g.id} onPress={() => setGradeId(g.id)} />)}</View>
        {gradeId && sameGrade(gradeId) ? <Text role="caption" tone="warning">{t('learners.sameGradeHint')} ({sameGrade(gradeId)!.displayName})</Text> : null}
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
      <View style={styles.block}>
        <Input label={t('learners.school')} value={school} onChangeText={setSchool} placeholder={t('account.school')} maxLength={120} />
      </View>
      {error ? <Text role="small" tone="danger">{t(errorMessageKey(error))}</Text> : null}
      {/* الزرّ المعطّل بلا سبب محيّر — نسمّي ما ينقص (الفصل الدراسي أشيع ما يُنسى) */}
      {!canSubmit && !busy ? <Text role="caption" tone="tertiary" center>{t('learners.missingFields', { fields: missing.join('، ') })}</Text> : null}
      <Button label={submitLabel} onPress={submit} loading={busy} disabled={!canSubmit} size="lg" full />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { gap: spacing[6], paddingTop: spacing[2] },
  block: { gap: spacing[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
}));
