import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { colors, spacing, radius, themed } from '@manassah/tokens';
import { Screen, Text, Icon, Button, Badge, Card } from '@/ui';
import { useBooking } from '@/features/queries';
import { api } from '@/api/client';
import { useCountdown } from '@/lib/hooks';
import { formatTime } from '@/lib/format';

type Check = 'testing' | 'ok' | 'bad';

/** قبل الدخول: الكاميرا والمايك والاتصال — ثم زرّ واحد واضح */
export default function PreCall() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = Number(id);
  const b = useBooking(bookingId);
  const [cam, requestCam] = useCameraPermissions();
  const [mic, requestMic] = useMicrophonePermissions();
  const [net, setNet] = useState<Check>('testing');
  const [latency, setLatency] = useState<number | null>(null);
  const left = useCountdown(b.data?.roomOpensAt);
  const canJoin = !!b.data?.canJoin;

  useEffect(() => { if (!cam?.granted) requestCam(); if (!mic?.granted) requestMic(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    const run = async () => { const t0 = Date.now(); try { await api.get('/health', undefined, undefined, { auth: false }); if (!alive) return; const ms = Date.now() - t0; setLatency(ms); setNet(ms < 1500 ? 'ok' : 'bad'); } catch { if (alive) setNet('bad'); } };
    run(); const iv = setInterval(run, 5000); return () => { alive = false; clearInterval(iv); };
  }, []);

  const row = (icon: 'camera' | 'mic' | 'wifi', label: string, state: Check, hint?: string) => (
    <View style={styles.check}>
      <View style={[styles.checkIcon, state === 'ok' && styles.okBg, state === 'bad' && styles.badBg]}><Icon name={icon} size={20} color={state === 'ok' ? colors.state.success : state === 'bad' ? colors.state.danger : colors.text.secondary} /></View>
      <View style={styles.flex}><Text role="bodyMedium">{label}</Text>{hint ? <Text role="caption" tone="secondary">{hint}</Text> : null}</View>
      <Badge label={state === 'ok' ? t('live.ready') : state === 'bad' ? t('live.notReady') : t('live.testing')} tone={state === 'ok' ? 'success' : state === 'bad' ? 'danger' : 'neutral'} />
    </View>
  );
  const camState: Check = cam == null ? 'testing' : cam.granted ? 'ok' : 'bad';
  const micState: Check = mic == null ? 'testing' : mic.granted ? 'ok' : 'bad';

  return (
    <Screen onBack={() => router.back()} title={t('lessons.precall.title')} loading={b.isLoading} error={b.error} onRetry={() => b.refetch()}
      footer={<Button label={canJoin ? t('live.joinNow') : left > 0 ? t('live.openIn', { m: Math.max(1, Math.ceil(left / 60)) }) : t('lessons.precall.join')} icon="video" size="lg" full disabled={!canJoin} onPress={() => router.replace(`/lesson/${bookingId}/room`)} />}>
      <View style={styles.wrap}>
        <Text role="body" tone="secondary">{t('live.precallBody')}</Text>
        <View style={styles.preview}>{cam?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="front" mute /> : <View style={styles.previewOff}><Icon name="cameraOff" size={32} color={colors.text.inverse} /><Text role="small" tone="inverse" center>{cam && !cam.granted ? t('live.permissionDenied') : t('live.testing')}</Text></View>}</View>
        <Card padded={false}><View style={styles.checks}>
          {row('camera', t('lessons.precall.camera'), camState, cam && !cam.granted && cam.canAskAgain ? undefined : cam && !cam.granted ? t('live.permissionDenied') : undefined)}
          {row('mic', t('lessons.precall.mic'), micState)}
          {row('wifi', t('lessons.precall.connection'), net, latency != null ? `${latency} ms · ${net === 'ok' ? t('lessons.precall.good') : t('lessons.precall.weak')}` : undefined)}
        </View></Card>
        {(cam && !cam.granted) || (mic && !mic.granted) ? <Button label={t('common.retry')} variant="secondary" icon="refresh" onPress={() => { requestCam(); requestMic(); }} /> : null}
        {b.data ? <Text role="caption" tone="tertiary" center tabular>{b.data.subject.name} · {formatTime(b.data.startsAt)}–{formatTime(b.data.endsAt)} · {t('common.timezoneNote')}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { gap: spacing[4], paddingTop: spacing[2] },
  preview: { aspectRatio: 4 / 3, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#1F1D1A' },
  previewOff: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2], padding: spacing[4] },
  checks: { paddingHorizontal: spacing[4] },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.default },
  checkIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.bg.subtle, alignItems: 'center', justifyContent: 'center' },
  okBg: { backgroundColor: c.state.successSoft },
  badBg: { backgroundColor: c.state.dangerSoft },
  flex: { flex: 1, minWidth: 0 },
}));
