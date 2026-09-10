import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { spacing } from '@manassah/tokens';
import { TeacherDocumentType } from '@manassah/shared';
import { Screen, Text, Button, Card, Badge } from '@/ui';
import { useTeacherMe, useUploadFile, useUploadTeacherDocument } from '@/features/queries';
import { errorMessageKey } from '@/api/client';
import { formatDayShort } from '@/lib/format';
import { safeBack } from '@/lib/session';

type DocType = typeof TeacherDocumentType.options[number];

const DOC_LABEL: Record<DocType, string> = {
  id: 'teacherUi.docId', degree: 'teacherUi.docDegree', certificate: 'teacherUi.docCertificate',
  photo: 'teacherUi.docPhoto', other: 'teacherUi.docOther',
};

/** مستندات المعلّم: رفض مستند واحد كان يعني إعادة الطلب كاملاً — هنا يُستبدل بعينه ويعود إلى المراجعة */
export default function TeacherDocuments() {
  const { t } = useTranslation();
  const router = useRouter();
  const q = useTeacherMe();
  const upload = useUploadFile();
  const replace = useUploadTeacherDocument();
  const [busy, setBusy] = useState<DocType | null>(null);

  const pick = async (type: DocType) => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'] });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    setBusy(type);
    // الرفع خطوتان (ملف ثم ربطه بالنوع)؛ فشل أيّهما يُعرض تحت البطاقة بدل أن يمرّ صامتاً
    try {
      const up = await upload.mutateAsync({ uri: a.uri, name: a.name, mime: a.mimeType ?? 'application/octet-stream', purpose: 'document', blob: a.file ?? undefined });
      await replace.mutateAsync({ type, fileId: up.id });
    } catch { /* السبب يُعرض من upload.error أو replace.error */ }
    finally { setBusy(null); }
  };

  const docs = q.data?.documents ?? [];
  return (
    <Screen onBack={() => safeBack(router)} title={t('teacherUi.documents')} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
      refreshing={q.isRefetching} onRefresh={() => q.refetch()}
      empty={!!q.data && docs.length === 0} emptyProps={{ icon: 'document', title: t('teacherUi.noDocuments'), actionLabel: t('teacherUi.reapply'), onAction: () => router.push('/teacher-app/apply') }}>
      <View style={styles.wrap}>
        <Text role="body" tone="secondary">{t('teacherUi.documentsHint')}</Text>
        {docs.map(d => (
          <Card key={d.id}>
            <View style={styles.head}>
              <Text role="bodyMedium" style={styles.flex}>{t(DOC_LABEL[d.type])}</Text>
              <Badge label={t(`teacherUi.docStatus.${d.status}`, { defaultValue: d.status })} tone={d.status === 'accepted' ? 'success' : d.status === 'rejected' ? 'danger' : 'warning'} />
            </View>
            <Text role="caption" tone="secondary">{t('teacherUi.uploadedAt')} {formatDayShort(d.created_at)}</Text>
            {d.note ? <Text role="small" tone={d.status === 'rejected' ? 'danger' : 'secondary'}>{t('teacherUi.rejectedReason')}: {d.note}</Text> : null}
            <Button label={t('teacherUi.reupload')} icon="upload" variant="secondary" size="sm" loading={busy === d.type} disabled={busy !== null} onPress={() => pick(d.type)} style={styles.mt} />
          </Card>
        ))}
        {upload.error || replace.error ? <Text role="small" tone="danger">{t(errorMessageKey(upload.error ?? replace.error))}</Text> : null}
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  mt: { marginTop: spacing[3] },
});
