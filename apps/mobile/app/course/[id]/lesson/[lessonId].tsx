import { useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { colors, spacing, radius } from '@manassah/tokens';
import { Screen, Text, Icon, Button, Chip, Card, Badge, EmptyState } from '@/ui';
import { usePlayLesson, useLessonProgress, useCourse } from '@/features/queries';
import { ApiError } from '@/api/client';
import { durationLabel } from '@/lib/format';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/** مشغّل الدرس: فيديو برابط موقّع، سرعات، ±١٠ث، حفظ الموضع، إكمال تلقائي، التالي/السابق؛ أو قراءة/اختبار */
export default function LessonPlayer() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id, lessonId } = useLocalSearchParams<{ id: string; lessonId: string }>();
  const courseId = Number(id), lid = Number(lessonId);
  const q = usePlayLesson(courseId, lid);
  const course = useCourse(courseId);
  const progress = useLessonProgress(courseId);
  const d = q.data;
  const [speed, setSpeed] = useState(1);
  const [done, setDone] = useState(false);
  const lastSave = useRef(0);

  const player = useVideoPlayer(d?.videoUrl ?? null, p => { p.timeUpdateEventInterval = 1; });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const time = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const current = Math.floor(time?.currentTime ?? 0);
  const total = d?.lesson.durationSeconds || Math.floor(player.duration || 0);

  useEffect(() => { if (d?.videoUrl && d.positionSeconds > 5) { player.currentTime = d.positionSeconds; } }, [d?.videoUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { player.playbackRate = speed; }, [speed, player]);
  useEffect(() => {
    if (!d || d.lesson.kind !== 'video' || !current) return;
    if (current - lastSave.current >= 10) { lastSave.current = current; progress.mutate({ lessonId: lid, positionSeconds: current }); }
    if (!done && total > 0 && current >= total * 0.9) { setDone(true); progress.mutate({ lessonId: lid, positionSeconds: current, completed: true }); }
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDone(!!d?.lesson.completed); lastSave.current = d?.positionSeconds ?? 0; }, [d?.lesson.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const markDone = () => { setDone(true); progress.mutate({ lessonId: lid, positionSeconds: current, completed: true }); };
  const paywall = q.error instanceof ApiError && q.error.status === 402;
  const idx = course.data ? course.data.sections.flatMap(s => s.lessons).findIndex(l => l.id === lid) : -1;
  const count = course.data?.lessonsCount ?? 0;

  return (
    <Screen onBack={() => router.back()} title={d?.lesson.title ?? course.data?.title ?? ''} subtitle={idx >= 0 ? t('playerUi.lessonOf', { i: idx + 1, n: count }) : undefined} loading={q.isLoading} error={paywall ? undefined : q.error} onRetry={() => q.refetch()} padded={false}
      footer={d ? (
        <View style={styles.nav}>
          <Button label={t('quizUi.prev')} variant="secondary" icon="back" disabled={!d.prev} onPress={() => d.prev && router.replace(`/course/${courseId}/lesson/${d.prev.id}`)} />
          {!done ? <Button label={t('courses.player.markDone')} variant="ghost" icon="check" onPress={markDone} /> : <Badge label={t('courses.player.completed')} tone="success" icon="check" />}
          <Button label={t('courses.player.next')} iconEnd="forward" disabled={!d.next || d.next.locked} onPress={() => d.next && router.replace(`/course/${courseId}/lesson/${d.next.id}`)} />
        </View>
      ) : undefined}>
      {paywall ? <EmptyState icon="lock" title={t('courses.locked')} body={t('errors.contentUnavailable')} actionLabel={t('courses.buy')} onAction={() => router.replace(`/course/${courseId}`)} /> : d ? (
        <View>
          {d.lesson.kind === 'video' ? (
            <View>
              <View style={styles.video}>
                {d.videoUrl ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
                  : <View style={styles.noVideo}><Icon name="cameraOff" size={30} color={colors.text.inverse} /><Text role="small" tone="inverse" center>{t('playerUi.noVideo')}</Text></View>}
              </View>
              {d.videoUrl ? (
                <View style={styles.controls}>
                  <View style={styles.track}><View style={[styles.fill, { width: `${total ? Math.min(100, (current / total) * 100) : 0}%` }]} /></View>
                  <View style={styles.row}>
                    <Text role="caption" tone="secondary" tabular>{durationLabel(current)} / {durationLabel(total)}</Text>
                    <View style={styles.btns}>
                      <Pressable onPress={() => player.seekBy(-10)} style={styles.ctl} accessibilityLabel="-10"><Icon name="replay" size={22} /></Pressable>
                      <Pressable onPress={() => isPlaying ? player.pause() : player.play()} style={[styles.ctl, styles.play]} accessibilityLabel={isPlaying ? 'pause' : 'play'}><Icon name={isPlaying ? 'pause' : 'play'} size={26} color={colors.text.inverse} /></Pressable>
                      <Pressable onPress={() => player.seekBy(10)} style={styles.ctl} accessibilityLabel="+10"><Icon name="forward10" size={22} /></Pressable>
                    </View>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.speeds}><Text role="caption" tone="secondary" style={styles.speedLabel}>{t('courses.player.speed')}</Text>{SPEEDS.map(s => <Chip key={s} small label={`${s}×`} selected={speed === s} onPress={() => setSpeed(s)} />)}</ScrollView>
                  {d.positionSeconds > 5 && current < 5 ? <Text role="caption" tone="tertiary" tabular>{t('playerUi.resume', { t: durationLabel(d.positionSeconds) })}</Text> : null}
                </View>
              ) : null}
            </View>
          ) : d.lesson.kind === 'reading' ? (
            <View style={styles.px}><Card><Text role="body" style={styles.reading}>{d.readingBody ?? ''}</Text></Card>{!done ? <Button label={t('courses.player.markDone')} icon="check" onPress={markDone} style={styles.mt} full /> : null}</View>
          ) : (
            <View style={styles.px}><Card accent><View style={styles.quiz}><Icon name="quiz" size={36} color={colors.brand.primary} /><Text role="h3">{d.lesson.title}</Text><Button label={t('playerUi.startQuiz')} icon="play" onPress={() => d.quizId && router.push({ pathname: `/quiz/${d.quizId}`, params: { lessonId: String(lid) } })} disabled={!d.quizId} /></View></Card></View>
          )}
          <View style={styles.px}><Text role="h3" style={styles.mt}>{d.lesson.title}</Text><Text role="caption" tone="tertiary" tabular>{t(`playerUi.${d.lesson.kind === 'video' ? 'lessonOf' : d.lesson.kind}`, { i: idx + 1, n: count })}{d.lesson.durationSeconds ? ` · ${durationLabel(d.lesson.durationSeconds)}` : ''}</Text></View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  px: { paddingHorizontal: spacing[4] },
  video: { aspectRatio: 16 / 9, backgroundColor: '#141210' },
  noVideo: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2], padding: spacing[4] },
  controls: { paddingHorizontal: spacing[4], paddingTop: spacing[3], gap: spacing[2] },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.bg.subtle, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.brand.primary },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btns: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  ctl: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.card, borderWidth: 1.5, borderColor: colors.border.default },
  play: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary, width: 52, height: 52, borderRadius: 26 },
  speeds: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  speedLabel: { marginEnd: spacing[1] },
  reading: { lineHeight: 28 },
  quiz: { alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  mt: { marginTop: spacing[4] },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
});
