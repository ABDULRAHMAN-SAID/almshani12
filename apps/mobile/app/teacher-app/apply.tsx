import { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { spacing, subjectColors, type SubjectColorKey } from '@manassah/tokens';
import { TeacherApplication } from '@manassah/shared';
import { Screen, Text, Button, Input, Chip, Card, SectionHeader } from '@/ui';
import { useCatalog, useApplyTeacher, useUploadFile } from '@/features/queries';
import { useAuth } from '@/state/auth';
import { errorMessageKey } from '@/api/client';

type DocType = 'id' | 'degree' | 'certificate';

/** طلب الانضمام كمعلّم — يُتحقّق منه بالعقد نفسه الذي يتحقّق به الخادم */
export default function ApplyTeacher() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useAuth(s => s.user);
  const catalog = useCatalog();
  const apply = useApplyTeacher();
  const upload = useUploadFile();
  const [f, setF] = useState({ displayName: user?.displayName ?? '', headline: '', bio: '', yearsExp: '', qualification: '', specialty: '', p30: '', p45: '', p60: '', g60: '' });
  const [subjects, setSubjects] = useState<number[]>([]);
  const [grades, setGrades] = useState<number[]>([]);
  const [languages, setLanguages] = useState<string[]>(['ar']);
  const [gender, setGender] = useState<'male' | 'female' | undefined>();
  const [docType, setDocType] = useState<DocType>('id');
  const [docs, setDocs] = useState<{ type: DocType; fileId: number; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // خطأ الحقل يزول بمجرّد تصحيحه — لا ينتظر إرسالاً جديداً
  const clear = (...ks: string[]) => setErrors(e => { const next = { ...e }; for (const k of ks) delete next[k]; return next; });
  const set = (k: keyof typeof f) => (v: string) => { setF(s => ({ ...s, [k]: v })); clear(k, 'prices'); };
  const toggle = (list: number[], setList: (l: number[]) => void, id: number, key: string) => { setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]); clear(key); };

  const payload = useMemo(() => ({
    displayName: f.displayName.trim(), headline: f.headline.trim(), bio: f.bio.trim(), yearsExp: Number(f.yearsExp) || 0, qualification: f.qualification.trim(), specialty: f.specialty.trim(),
    subjectIds: subjects, gradeIds: grades, languages, gender,
    prices: [
      ...([[30, f.p30], [45, f.p45], [60, f.p60]] as const).filter(([, v]) => Number(v) > 0).map(([d, v]) => ({ durationMinutes: d as 30 | 45 | 60, mode: 'individual' as 'individual' | 'group', price: Number(v) })),
      ...(Number(f.g60) > 0 ? [{ durationMinutes: 60 as 30 | 45 | 60, mode: 'group' as 'individual' | 'group', price: Number(f.g60) }] : []),
    ],
    documents: docs.map(d => ({ type: d.type, fileId: d.fileId })),
  }), [f, subjects, grades, languages, gender, docs]);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'] });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    const up = await upload.mutateAsync({ uri: a.uri, name: a.name, mime: a.mimeType ?? 'application/octet-stream', purpose: 'document', blob: a.file ?? undefined });
    setDocs(d => [...d, { type: docType, fileId: up.id, name: a.name }]);
    clear('documents');
  };
  const submit = () => {
    const parsed = TeacherApplication.safeParse(payload);
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0]), i.message]))); return; }
    setErrors({});
    apply.mutate(parsed.data, { onSuccess: () => router.replace('/teacher-app') });
  };
  // رسالة الحقل نفسها من العقد، لا «بعض البيانات غير صحيحة» مكرّرة تحت كل حقل
  const err = (k: string) => errors[k] ? (k === 'documents' ? t('teacherUi.docsNeeded') : errors[k]) : undefined;
  const subjectList = catalog.data?.subjects ?? [], gradeList = catalog.data?.grades ?? [];

  return (
    <Screen onBack={() => router.back()} title={t('teacherApp.apply.title')} loading={catalog.isLoading} error={catalog.error} onRetry={() => catalog.refetch()}
      footer={<Button label={t('teacherApp.apply.submit')} size="lg" full loading={apply.isPending} onPress={submit} />}>
      <View style={styles.wrap}>
        <Text role="body" tone="secondary">{t('teacherUi.applyIntro')}</Text>
        <Input label={t('onboarding.yourName')} value={f.displayName} onChangeText={set('displayName')} error={err('displayName')} />
        <Input label={t('teacherUi.headline')} value={f.headline} onChangeText={set('headline')} placeholder="فيزياء الدبلوم العام — ١٠ أعوام خبرة" error={err('headline')} />
        <Input label={t('teacherUi.bio')} value={f.bio} onChangeText={set('bio')} multiline numberOfLines={4} error={err('bio')} helper={`${f.bio.trim().length}/2000`} />
        <View style={styles.row}><View style={styles.flex}><Input label={t('teacherUi.qualification')} value={f.qualification} onChangeText={set('qualification')} error={err('qualification')} /></View><View style={styles.flex}><Input label={t('teacherUi.specialty')} value={f.specialty} onChangeText={set('specialty')} error={err('specialty')} /></View></View>
        <Input label={t('teacherUi.years')} value={f.yearsExp} onChangeText={set('yearsExp')} keyboardType="number-pad" numeric error={err('yearsExp')} />
        <SectionHeader title={t('teacherUi.subjects')} />
        <View style={styles.chips}>{subjectList.map(s => { const sc = subjectColors[(s.colorKey as SubjectColorKey)] ?? subjectColors.default; const on = subjects.includes(s.id); return <Chip key={s.id} label={s.name} selected={on} color={on ? sc.main : undefined} softColor={on ? sc.soft : undefined} onPress={() => toggle(subjects, setSubjects, s.id, 'subjectIds')} />; })}</View>
        {err('subjectIds') ? <Text role="caption" tone="danger">{err('subjectIds')}</Text> : null}
        <SectionHeader title={t('teacherUi.grades')} />
        <View style={styles.chips}>{gradeList.map(g => <Chip key={g.id} label={g.name} selected={grades.includes(g.id)} onPress={() => toggle(grades, setGrades, g.id, 'gradeIds')} />)}</View>
        {err('gradeIds') ? <Text role="caption" tone="danger">{err('gradeIds')}</Text> : null}
        <SectionHeader title={t('teacherUi.prices')} subtitle={t('teachers.individual')} />
        <View style={styles.row}><View style={styles.flex}><Input label="٣٠ د" value={f.p30} onChangeText={set('p30')} keyboardType="decimal-pad" numeric /></View><View style={styles.flex}><Input label="٤٥ د" value={f.p45} onChangeText={set('p45')} keyboardType="decimal-pad" numeric /></View><View style={styles.flex}><Input label="٦٠ د" value={f.p60} onChangeText={set('p60')} keyboardType="decimal-pad" numeric /></View></View>
        <Input label={`${t('teachers.group')} · ٦٠ د`} value={f.g60} onChangeText={set('g60')} keyboardType="decimal-pad" numeric />
        {err('prices') ? <Text role="caption" tone="danger">{err('prices')}</Text> : null}
        <SectionHeader title={t('teachers.language')} />
        <View style={styles.chips}><Chip label="العربية" selected={languages.includes('ar')} onPress={() => setLanguages(l => l.includes('ar') ? l.filter(x => x !== 'ar') : [...l, 'ar'])} /><Chip label="English" selected={languages.includes('en')} onPress={() => setLanguages(l => l.includes('en') ? l.filter(x => x !== 'en') : [...l, 'en'])} /></View>
        <SectionHeader title={t('teachers.gender')} />
        <View style={styles.chips}><Chip label={t('teachers.male')} selected={gender === 'male'} onPress={() => setGender('male')} /><Chip label={t('teachers.female')} selected={gender === 'female'} onPress={() => setGender('female')} /></View>
        <SectionHeader title={t('teacherApp.apply.docs')} />
        <Card>
          <View style={styles.chips}>{(['id', 'degree', 'certificate'] as DocType[]).map(d => <Chip key={d} label={t(`teacherUi.doc${d[0].toUpperCase()}${d.slice(1)}`)} selected={docType === d} onPress={() => setDocType(d)} />)}</View>
          <Button label={t('teacherUi.pickDoc')} icon="upload" variant="secondary" size="sm" loading={upload.isPending} onPress={pick} style={styles.mt} />
          <View style={[styles.chips, styles.mt]}>{docs.map(d => <Chip key={d.fileId} label={`${t(`teacherUi.doc${d.type[0].toUpperCase()}${d.type.slice(1)}`)}: ${d.name}`} icon="close" onPress={() => setDocs(l => l.filter(x => x.fileId !== d.fileId))} />)}</View>
          {err('documents') ? <Text role="caption" tone="danger">{err('documents')}</Text> : null}
        </Card>
        {apply.error ? <Text role="small" tone="danger">{t(errorMessageKey(apply.error))}</Text> : null}
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({ wrap: { gap: spacing[3], paddingTop: spacing[2] }, row: { flexDirection: 'row', gap: spacing[2] }, flex: { flex: 1, minWidth: 0 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }, mt: { marginTop: spacing[3] } });
