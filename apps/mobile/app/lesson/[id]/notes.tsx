import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { spacing } from '@manassah/tokens';
import { Screen, Text, Button, Input, Chip, Card, EmptyState } from '@/ui';
import { useBooking, usePostNotes, useUploadFile } from '@/features/queries';
import { useAuth } from '@/state/auth';
import { errorMessageKey } from '@/api/client';

/** ملاحظات المعلّم بعد الحصة: ملخّص، واجب، مرفقات — تصل للطالب فوراً */
export default function LessonNotes() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = Number(id);
  const user = useAuth(s => s.user);
  const b = useBooking(bookingId);
  const post = usePostNotes(bookingId);
  const upload = useUploadFile();
  const [summary, setSummary] = useState('');
  const [homework, setHomework] = useState('');
  const [files, setFiles] = useState<{ id: number; name: string }[]>([]);
  // الحجز يصل بعد التركيب: نملأ النموذج بالملاحظات الحالية مرة واحدة حتى لا يُمسح الواجب المحفوظ عند الحفظ
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !b.data) return;
    setSummary(b.data.notes?.summary ?? '');
    setHomework(b.data.notes?.homework ?? '');
    setSeeded(true);
  }, [b.data, seeded]);
  // شاشة المعلّم فقط — الطالب يُعاد لصفحة الحصة (الخادم يردّ 403 على أي حال)
  const forbidden = !!b.data && b.data.teacher.id !== user?.id;

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    const up = await upload.mutateAsync({ uri: a.uri, name: a.name, mime: a.mimeType ?? 'application/octet-stream', purpose: 'attachment', blob: a.file ?? undefined });
    setFiles(f => [...f, { id: up.id, name: a.name }]);
  };

  if (forbidden) {
    return (
      <Screen onBack={() => router.back()} title={t('teacherUi.notes')}>
        <EmptyState icon="warning" title={t('errors.forbidden')} actionLabel={t('lessons.details')} onAction={() => router.replace(`/lesson/${bookingId}`)} />
      </Screen>
    );
  }

  return (
    <Screen onBack={() => router.back()} title={t('teacherUi.notes')} loading={b.isLoading} error={b.error} onRetry={() => b.refetch()}
      footer={<Button label={t('teacherUi.saveNotes')} icon="send" size="lg" full loading={post.isPending} disabled={!seeded || (!summary.trim() && !homework.trim())} onPress={() => post.mutate({ summary: summary.trim() || null, homework: homework.trim() || null, attachmentFileIds: files.map(f => f.id), suggestNext: false }, { onSuccess: () => router.replace(`/lesson/${bookingId}`) })} />}>
      <View style={styles.wrap}>
        <Text role="body" tone="secondary">{t('teacherUi.notesHint')}</Text>
        {b.data ? <Card><Text role="bodyMedium">{b.data.subject.name} · {b.data.student.name}</Text></Card> : null}
        <Input label={t('lessons.post.summary')} value={summary} onChangeText={setSummary} placeholder={t('teacherUi.summaryPh')} multiline numberOfLines={4} maxLength={3000} />
        <Input label={t('lessons.post.homework')} value={homework} onChangeText={setHomework} placeholder={t('teacherUi.homeworkPh')} multiline numberOfLines={3} maxLength={3000} />
        <View style={styles.files}>
          {files.map(f => <Chip key={f.id} label={f.name} icon="close" onPress={() => setFiles(l => l.filter(x => x.id !== f.id))} />)}
          <Button label={t('lessons.post.attachments')} icon="attach" variant="secondary" size="sm" loading={upload.isPending} onPress={pick} />
        </View>
        {post.error ? <Text role="small" tone="danger">{t(errorMessageKey(post.error))}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ wrap: { gap: spacing[4], paddingTop: spacing[2] }, files: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], alignItems: 'center' } });
