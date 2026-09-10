import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { colors, spacing } from '@manassah/tokens';
import { BookType, BookUpsert } from '@manassah/shared';
import { Screen, Text, Button, Input, Chip, Card, Badge, BottomSheet, EmptyState } from '@/ui';
import { useMyBooks, useCreateBook, useUploadBookFile, useSubmitBook, useCatalog } from '@/features/queries';
import { errorMessageKey } from '@/api/client';
import { money } from '@/lib/format';
import { safeBack } from '@/lib/session';

const STATUS_TONE = { draft: 'neutral', pending_review: 'warning', approved: 'info', rejected: 'danger', published: 'success', archived: 'neutral' } as const;

/** كتب المعلّم: إنشاء، رفع الملف الكامل والمعاينة، إرسال للمراجعة — النشر بقرار المراجع */
export default function TeacherBooks() {
  const { t } = useTranslation();
  const router = useRouter();
  const books = useMyBooks();
  const catalog = useCatalog();
  const create = useCreateBook();
  const upload = useUploadBookFile();
  const submit = useSubmitBook();
  const [sheet, setSheet] = useState(false);
  const [f, setF] = useState({ title: '', description: '', price: '', pages: '' });
  const [type, setType] = useState<typeof BookType.options[number]>('summary');
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [gradeId, setGradeId] = useState<number | null>(null);
  const [semesterId, setSemesterId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pickAndUpload = async (bookId: number, kind: 'full' | 'preview') => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    // فشل الرفع كان يخرج رفضاً غير ملتقَط: الرسالة تُعرض من upload.error تحت البطاقات، فلا داعي لإسقاط الشاشة
    try { await upload.mutateAsync({ bookId, kind, uri: a.uri, name: a.name, mime: a.mimeType ?? 'application/pdf', blob: a.file ?? undefined }); }
    catch { /* السبب يُعرض من upload.error */ }
  };
  const save = () => {
    const parsed = BookUpsert.safeParse({ title: f.title, type, subjectId, gradeId, semesterId, description: f.description, learnPoints: [], toc: [], price: Number(f.price) || 0, pages: Number(f.pages) || null, edition: null, version: null, language: 'ar', level: null, previewPages: 5, tags: [] });
    if (!parsed.success) { setErr(t('errors.validation')); return; }
    setErr(null);
    create.mutate(parsed.data, { onSuccess: () => { setSheet(false); setF({ title: '', description: '', price: '', pages: '' }); } });
  };

  return (
    <Screen onBack={() => safeBack(router)} title={t('teacherApp.quick.uploadBook')} loading={books.isLoading} error={books.error} onRetry={() => books.refetch()}
      right={<Button label={t('common.new')} icon="plus" size="sm" onPress={() => setSheet(true)} />}
      empty={!!books.data && books.data.length === 0} emptyProps={{ icon: 'book', title: t('teacherUi.noBooks'), actionLabel: t('teacherApp.quick.uploadBook'), onAction: () => setSheet(true) }}>
      <View style={styles.list}>
        {books.data?.map(b => (
          <Card key={b.id}>
            <View style={styles.head}><Text role="bodyMedium" style={styles.flex} numberOfLines={2}>{b.title}</Text><Badge label={t(`library.status.${b.status}`, { defaultValue: b.status })} tone={STATUS_TONE[b.status as keyof typeof STATUS_TONE] ?? 'neutral'} /></View>
            <Text role="caption" tone="secondary">{t(`library.types.${b.type}`)} · {b.subject.name} · {b.grade.name} · {money(b.price)} · {t('library.sold', { n: b.salesCount })}</Text>
            {b.rejectReason ? <Text role="small" tone="danger">{t('teacherUi.rejectedReason')}: {b.rejectReason}</Text> : null}
            <View style={styles.actions}>
              <Button label={b.hasFile ? `PDF ✓` : t('common.pages')} variant="secondary" size="sm" icon="upload" loading={upload.isPending} onPress={() => pickAndUpload(b.id, 'full')} />
              <Button label={t('book.preview')} variant="secondary" size="sm" icon="upload" onPress={() => pickAndUpload(b.id, 'preview')} />
              {['draft', 'rejected'].includes(b.status) ? <Button label={t('teacherApp.apply.submit')} size="sm" icon="send" disabled={!b.hasFile} loading={submit.isPending} onPress={() => submit.mutate(b.id)} /> : null}
              {b.status === 'published' ? <Button label={t('common.details')} variant="ghost" size="sm" onPress={() => router.push(`/book/${b.id}`)} /> : null}
            </View>
          </Card>
        ))}
        {submit.error || upload.error ? <Text role="small" tone="danger">{t(errorMessageKey(submit.error ?? upload.error))}</Text> : null}
      </View>
      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title={t('teacherApp.quick.uploadBook')} footer={<Button label={t('common.save')} full loading={create.isPending} onPress={save} />}>
        <View style={styles.form}>
          <View style={styles.chips}>{BookType.options.map(ty => <Chip key={ty} small label={t(`library.types.${ty}`)} selected={type === ty} onPress={() => setType(ty)} />)}</View>
          <Input label={t('book.titleField')} value={f.title} onChangeText={v => setF(s => ({ ...s, title: v }))} />
          <Text role="caption" tone="secondary">{t('common.subject')}</Text>
          <View style={styles.chips}>{(catalog.data?.subjects ?? []).map(s => <Chip key={s.id} small label={s.name} selected={subjectId === s.id} onPress={() => setSubjectId(s.id)} />)}</View>
          <Text role="caption" tone="secondary">{t('common.grade')}</Text>
          <View style={styles.chips}>{(catalog.data?.grades ?? []).map(g => <Chip key={g.id} small label={g.name} selected={gradeId === g.id} onPress={() => setGradeId(g.id)} />)}</View>
          <Text role="caption" tone="secondary">{t('common.semester')}</Text>
          <View style={styles.chips}>{(catalog.data?.semesters ?? []).map(s => <Chip key={s.id} small label={s.name} selected={semesterId === s.id} onPress={() => setSemesterId(s.id)} />)}</View>
          <Input label={t('book.description')} value={f.description} onChangeText={v => setF(s => ({ ...s, description: v }))} multiline numberOfLines={3} />
          <View style={styles.row}><View style={styles.flex}><Input label={`${t('common.price')} (ر.ع)`} value={f.price} onChangeText={v => setF(s => ({ ...s, price: v }))} keyboardType="decimal-pad" numeric /></View><View style={styles.flex}><Input label={t('book.pages')} value={f.pages} onChangeText={v => setF(s => ({ ...s, pages: v }))} keyboardType="number-pad" numeric /></View></View>
          {err || create.error ? <Text role="small" tone="danger">{err ?? t(errorMessageKey(create.error))}</Text> : null}
        </View>
      </BottomSheet>
    </Screen>
  );
}
const styles = StyleSheet.create({
  list: { gap: spacing[3], paddingTop: spacing[2] },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] },
  flex: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3] },
  form: { gap: spacing[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1] },
  row: { flexDirection: 'row', gap: spacing[2] },
});
