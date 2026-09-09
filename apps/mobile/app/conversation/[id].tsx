import { useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { Screen, Text, Button, Input, RowSkeleton, ErrorState } from '@/ui';
import { useMessages, useSendMessage, useConversations } from '@/features/queries';
import { useAuth } from '@/state/auth';
import { errorMessageKey } from '@/api/client';
import { formatTime, relativeDay, dayKey } from '@/lib/format';

/** محادثة طالب–معلّم: فقاعات بسيطة، تحديث دوري، إرسال بالإدخال */
export default function Conversation() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = Number(id);
  const me = useAuth(s => s.user);
  const q = useMessages(convId);
  const convs = useConversations();
  const send = useSendMessage(convId);
  const [text, setText] = useState('');
  const scroll = useRef<ScrollView>(null);
  const other = convs.data?.find(c => c.id === convId)?.other;
  // الصفحات تُجلب من الأحدث إلى الأقدم، والعرض بالعكس: الأقدم أعلى الشاشة
  const msgs = useMemo(() => [...(q.data?.pages ?? [])].reverse().flat(), [q.data]);
  // جلب الأقدم يزيد ارتفاع المحتوى: بلا هذه الراية يقفز العرض إلى آخر المحادثة فلا يرى المستخدم ما جلبه
  const older = useRef(false);
  const loadOlder = () => { older.current = true; q.fetchNextPage(); };
  useEffect(() => { if (older.current) return; scroll.current?.scrollToEnd({ animated: false }); }, [msgs.length]);
  // مفتاح «إرسال» في لوحة المفاتيح لا يمرّ بتعطيل الزرّ: بلا هذا الحارس تُرسل الرسالة مرّتين على شبكة بطيئة
  const submit = () => { if (send.isPending) return; const body = text.trim(); if (!body) return; send.mutate({ kind: 'text', body }, { onSuccess: () => setText('') }); };

  let lastDay = '';
  return (
    <Screen onBack={() => router.back()} title={other?.name ?? t('messagesUi.title')} scroll={false} padded={false}
      /* محادثة غير موجودة أو ممنوعة: لا نعرض حقل كتابة لا يصل إلى أحد */
      footer={q.error ? undefined : <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={styles.inputRow}><View style={styles.flex}><Input value={text} onChangeText={setText} placeholder={t('messagesUi.placeholder')} onSubmitEditing={submit} returnKeyType="send" blurOnSubmit={false} /></View><Button label={t('messagesUi.send')} icon="send" onPress={submit} loading={send.isPending} disabled={!text.trim()} /></View>{send.error ? <Text role="caption" tone="danger">{t(errorMessageKey(send.error))}</Text> : null}</KeyboardAvoidingView>}>
      {q.isLoading ? <View style={styles.px}><RowSkeleton /><RowSkeleton /></View> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} onBack={() => router.back()} /> : (
        <ScrollView ref={scroll} contentContainerStyle={styles.msgs} onContentSizeChange={() => { if (older.current) { older.current = false; return; } scroll.current?.scrollToEnd({ animated: true }); }}>
          {msgs.length === 0 ? <Text role="small" tone="tertiary" center>{t('live.noMessages')}</Text> : null}
          {q.hasNextPage ? <Button label={t('messagesUi.loadOlder')} variant="ghost" size="sm" loading={q.isFetchingNextPage} onPress={loadOlder} /> : null}
          {msgs.map(m => {
            const day = dayKey(m.createdAt); const showDay = day !== lastDay; lastDay = day;
            const mine = m.senderId === me?.id;
            return (
              <View key={m.id}>
                {showDay ? <Text role="caption" tone="tertiary" center style={styles.day}>{relativeDay(m.createdAt)}</Text> : null}
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  {m.body ? <Text role="body">{m.body}</Text> : null}
                  {m.fileUrl ? <Text role="small" tone="link">📎 {m.kind}</Text> : null}
                  <Text role="caption" tone="tertiary" tabular style={styles.time}>{formatTime(m.createdAt)}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}
const styles = themed((c) => StyleSheet.create({
  px: { paddingHorizontal: spacing[4] },
  msgs: { paddingHorizontal: spacing[4], paddingVertical: spacing[3], gap: spacing[2] },
  day: { marginVertical: spacing[2] },
  bubble: { maxWidth: '84%', padding: spacing[3], borderRadius: radius.lg, gap: 2 },
  mine: { alignSelf: 'flex-end', backgroundColor: c.brand.primarySoft, borderBottomEndRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: c.bg.card, borderWidth: 1.5, borderColor: c.border.default, borderBottomStartRadius: 4 },
  time: { alignSelf: 'flex-end' },
  inputRow: { flexDirection: 'row', gap: spacing[2], alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
}));
