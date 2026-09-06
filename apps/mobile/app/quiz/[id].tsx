import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius } from '@manassah/tokens';
import type { z } from 'zod';
import type { QuizResult } from '@manassah/shared';
import { Screen, Text, Icon, Button, Input, Card, Badge, EmptyState } from '@/ui';
import { useQuiz, useSubmitQuiz, useLessonProgress } from '@/features/queries';
import { ApiError, errorMessageKey } from '@/api/client';
import { durationLabel } from '@/lib/format';

type Answer = number[] | string;

/** الاختبار: سؤال واحد في الشاشة، مؤقّت إن وُجد، تصحيح في الخادم، ثم النتيجة بالشرح و«راجع نقاط ضعفك» */
export default function Quiz() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id, lessonId } = useLocalSearchParams<{ id: string; lessonId?: string }>();
  const quizId = Number(id);
  const q = useQuiz(quizId);
  const submit = useSubmitQuiz(quizId);
  const progress = useLessonProgress(0);
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [left, setLeft] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [result, setResult] = useState<z.infer<typeof QuizResult> | null>(null);
  const quiz = q.data;
  const qs = quiz?.questions ?? [];
  const cur = qs[i];
  const answered = useMemo(() => qs.filter(x => { const a = answers[String(x.id)]; return Array.isArray(a) ? a.length > 0 : !!a?.trim(); }).length, [qs, answers]);

  const send = () => submit.mutate({ answers, durationSeconds: Math.round((Date.now() - startedAt) / 1000) }, { onSuccess: r => { setResult(r); if (lessonId) progress.mutate({ lessonId: Number(lessonId), positionSeconds: 0, completed: r.passed }); } });
  useEffect(() => {
    if (!started || !quiz?.timeLimitSeconds || result) return;
    const iv = setInterval(() => setLeft(l => { if (l <= 1) { clearInterval(iv); send(); return 0; } return l - 1; }), 1000);
    return () => clearInterval(iv);
  }, [started, quiz?.timeLimitSeconds, result]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => { setStarted(true); setStartedAt(Date.now()); setLeft(quiz?.timeLimitSeconds ?? 0); setI(0); setAnswers({}); setResult(null); };
  const toggle = (qid: number, idx: number, single: boolean) => setAnswers(a => { const curA = Array.isArray(a[qid]) ? (a[qid] as number[]) : []; return { ...a, [qid]: single ? [idx] : curA.includes(idx) ? curA.filter(x => x !== idx) : [...curA, idx] }; });
  const paywall = q.error instanceof ApiError && q.error.status === 402;

  if (paywall) return <Screen onBack={() => router.back()}><EmptyState icon="lock" title={t('courses.locked')} body={t('errors.contentUnavailable')} /></Screen>;

  return (
    <Screen onBack={() => router.back()} title={quiz?.title ?? ''} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
      footer={started && !result && cur ? (
        <View style={styles.nav}>
          <Button label={t('quizUi.prev')} variant="secondary" disabled={i === 0} onPress={() => setI(i - 1)} />
          <Text role="caption" tone="secondary" tabular>{t('quiz.question', { i: i + 1, n: qs.length })}</Text>
          {i < qs.length - 1 ? <Button label={t('common.next')} onPress={() => setI(i + 1)} /> : <Button label={t('quiz.submit')} loading={submit.isPending} disabled={answered < qs.length} onPress={send} />}
        </View>
      ) : undefined}>
      {quiz && !started ? (
        <View style={styles.intro}>
          <View style={styles.introIcon}><Icon name="quiz" size={40} color={colors.brand.primary} /></View>
          <Text role="h1" center>{quiz.title}</Text>
          <Text role="body" tone="secondary" center>{t('quizUi.intro', { n: quiz.questions.length, p: quiz.passScore })} · {quiz.timeLimitSeconds ? t('quizUi.timed', { m: Math.round(quiz.timeLimitSeconds / 60) }) : t('quizUi.noLimit')}</Text>
          {quiz.attemptsAllowed > 0 ? <Text role="caption" tone="tertiary" center tabular>{t('quiz.attemptsLeft', { n: Math.max(0, quiz.attemptsAllowed - quiz.attemptsUsed) })}</Text> : null}
          {quiz.attemptsAllowed > 0 && quiz.attemptsUsed >= quiz.attemptsAllowed ? <Badge label={t('quizUi.noAttempts')} tone="warning" /> : <Button label={t('quiz.start')} size="lg" icon="play" onPress={start} />}
        </View>
      ) : null}

      {started && !result && cur ? (
        <View style={styles.wrap}>
          <View style={styles.meta}>
            <View style={styles.track}><View style={[styles.fill, { width: `${((i + 1) / qs.length) * 100}%` }]} /></View>
            {quiz?.timeLimitSeconds ? <Text role="caption" tone={left < 30 ? 'danger' : 'secondary'} tabular>{t('quiz.timeLeft')}: {durationLabel(left)}</Text> : null}
          </View>
          <Card>
            <Text role="caption" tone="tertiary">{cur.topicTag ?? ''}</Text>
            <Text role="h3" style={styles.qText}>{cur.text}</Text>
            {cur.type === 'short' ? (
              <Input value={typeof answers[cur.id] === 'string' ? (answers[cur.id] as string) : ''} onChangeText={v => setAnswers(a => ({ ...a, [cur.id]: v }))} placeholder={t('quizUi.shortPlaceholder')} />
            ) : (cur.type === 'true_false' ? [t('quizUi.trueLabel'), t('quizUi.falseLabel')] : cur.options).map((opt, oi) => {
              const on = Array.isArray(answers[cur.id]) && (answers[cur.id] as number[]).includes(oi);
              return (
                <Pressable key={oi} onPress={() => toggle(cur.id, oi, true)} style={[styles.opt, on && styles.optOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <View style={[styles.radio, on && styles.radioOn]}>{on ? <Icon name="check" size={14} color={colors.text.inverse} /> : null}</View>
                  <Text role="body" style={styles.flex}>{opt}</Text>
                </Pressable>
              );
            })}
          </Card>
          {answered < qs.length && i === qs.length - 1 ? <Text role="caption" tone="warning" center>{t('quizUi.unanswered')}</Text> : null}
          {submit.error ? <Text role="small" tone="danger" center>{t(errorMessageKey(submit.error))}</Text> : null}
        </View>
      ) : null}

      {result ? (
        <View style={styles.wrap}>
          <Card accent>
            <View style={styles.resultHead}>
              <View style={[styles.score, result.passed ? styles.scoreOk : styles.scoreBad]}><Text role="display" tone="inverse" tabular>{result.percent}٪</Text></View>
              <Text role="h2">{result.passed ? t('quiz.passed') : t('quiz.failed')}</Text>
              <Text role="small" tone="secondary" tabular>{t('quizUi.scoreOf', { s: result.score, m: result.maxScore })} · {t('quiz.time')}: {durationLabel(result.durationSeconds)}</Text>
            </View>
          </Card>
          {result.topics.length ? (
            <Card>
              <Text role="h3" style={styles.mb}>{t('quiz.weakPoints')}</Text>
              {[...result.topics].sort((a, b) => a.percent - b.percent).map(tp => (
                <View key={tp.topic} style={styles.topic}><Text role="body" style={styles.flex}>{tp.topic}</Text><View style={styles.topicTrack}><View style={[styles.topicFill, { width: `${tp.percent}%`, backgroundColor: tp.percent >= 60 ? colors.state.success : colors.state.danger }]} /></View><Text role="caption" tabular tone={tp.percent >= 60 ? 'success' : 'danger'}>{tp.percent}٪</Text></View>
              ))}
            </Card>
          ) : null}
          <Text role="h3">{t('quiz.explanations')}</Text>
          {result.breakdown.map((b, bi) => { const qq = qs.find(x => x.id === b.questionId); if (!qq) return null;
            const show = (a: unknown) => Array.isArray(a) ? a.map(x => qq.type === 'true_false' ? [t('quizUi.trueLabel'), t('quizUi.falseLabel')][Number(x)] : qq.options[Number(x)]).join('، ') : String(a ?? '—');
            return (
              <Card key={b.questionId} rail={b.correct ? colors.state.success : colors.state.danger}>
                <Text role="bodyMedium">{bi + 1}. {qq.text}</Text>
                <Text role="small" tone={b.correct ? 'success' : 'danger'}>{t('quizUi.yourAnswer')}: {show(b.given)} — {b.correct ? t('quiz.correct') : t('quiz.wrong')}</Text>
                {!b.correct ? <Text role="small" tone="secondary">{t('quizUi.correctAnswer')}: {show(b.answer)}</Text> : null}
                {b.explanation ? <Text role="caption" tone="tertiary" style={styles.expl}>{b.explanation}</Text> : null}
              </Card>
            ); })}
          {quiz && (quiz.attemptsAllowed === 0 || quiz.attemptsUsed + 1 < quiz.attemptsAllowed) ? <Button label={t('quiz.retry')} variant="secondary" icon="refresh" onPress={() => { q.refetch(); start(); }} full /> : null}
          <Button label={t('common.done')} onPress={() => router.back()} full />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { alignItems: 'center', gap: spacing[3], paddingTop: spacing[8] },
  introIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  wrap: { gap: spacing[3], paddingTop: spacing[2] },
  meta: { gap: spacing[1] },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.bg.subtle, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.brand.primary },
  qText: { marginVertical: spacing[3], lineHeight: 28 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3], borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border.default, marginBottom: spacing[2], minHeight: 52 },
  optOn: { borderColor: colors.brand.primary, backgroundColor: colors.brand.primarySoft },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border.strong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  flex: { flex: 1, minWidth: 0 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  resultHead: { alignItems: 'center', gap: spacing[2] },
  score: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center' },
  scoreOk: { backgroundColor: colors.state.success }, scoreBad: { backgroundColor: colors.state.danger },
  mb: { marginBottom: spacing[3] },
  topic: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[2] },
  topicTrack: { width: 90, height: 6, borderRadius: 3, backgroundColor: colors.bg.subtle, overflow: 'hidden' },
  topicFill: { height: '100%' },
  expl: { marginTop: spacing[1] },
});
