import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, hitTarget, themed } from '@manassah/tokens';
import { Text, Icon, Button, Badge, Avatar, Input, BottomSheet, Dialog, ErrorState, ScreenSkeleton, VideoTile, Whiteboard, type IconName } from '@/ui';
import { useLiveRoom } from '@/features/room';
import { useRoom } from '@/state/room';
import { formatTime } from '@/lib/format';

/** القاعة: فيديو، كتم، كاميرا، دردشة، يد، مشاركون، سبّورة، مشاركة، مؤقّت، مؤشّر اتصال — وإعادة اتصال بلا طرد.
 * المسرح داكن دائماً في السِمتين، فنصوصه بأبيض ثابت (text.onPrimary) لا بـ tone="inverse" الذي ينقلب في الوضع الليلي. */
export default function Room() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = Number(id);
  const room = useLiveRoom(bookingId);
  const st = useRoom();
  const [sheet, setSheet] = useState<null | 'chat' | 'people' | 'board' | 'more'>(null);
  const [dialog, setDialog] = useState<null | 'leave' | 'end'>(null);
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  useEffect(() => { if (sheet === 'chat') st.set({ unread: 0 }); }, [sheet, st.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const b = room.access?.booking;
  // الطرف الآخر = طرف الحجز لا «أوّل من ليس أنا»: حساب إدارة قد يدخل الغرفة فيُعرض فيديوه تحت اسم الطالب
  const other = useMemo(() => {
    const id = b ? (st.me?.userId === b.teacher.id ? b.student.id : st.me?.userId === b.student.id ? b.teacher.id : null) : null;
    return st.participants.find(p => (id !== null ? p.userId === id : p.userId !== st.me?.userId)) ?? null;
  }, [st.participants, st.me, b]);
  const otherName = other?.name ?? (b ? (st.me?.role === 'teacher' ? b.student.name : b.teacher.name) : '');
  const elapsed = b ? Math.max(0, Math.floor((now - new Date(b.startsAt).getTime()) / 1000)) : 0;
  const remaining = b ? Math.max(0, Math.floor((new Date(b.endsAt).getTime() - now) / 1000)) : 0;
  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const ended = st.connection === 'ended';

  const exit = () => { room.leave(); router.replace(`/lesson/${bookingId}`); };
  const afterEnd = () => { room.leave(); router.replace(st.me?.role === 'teacher' ? `/lesson/${bookingId}/notes` : `/lesson/${bookingId}/review`); };

  const ctl = (icon: IconName, label: string, onPress: () => void, opts: { active?: boolean; danger?: boolean; badge?: number; disabled?: boolean } = {}) => (
    <Pressable key={label} onPress={onPress} disabled={opts.disabled} accessibilityRole="button" accessibilityLabel={label} style={[styles.ctl, opts.active && styles.ctlActive, opts.danger && styles.ctlDanger, opts.disabled && styles.ctlDisabled]}>
      <Icon name={icon} size={22} color={opts.active ? colors.brand.primary : colors.text.onPrimary} />
      {opts.badge ? <View style={styles.badge}><Text role="caption" color={colors.text.onPrimary} tabular style={styles.badgeText}>{opts.badge}</Text></View> : null}
      <Text role="caption" color={colors.text.onPrimary} numberOfLines={1} style={styles.ctlLabel}>{label}</Text>
    </Pressable>
  );

  if (room.error) return <SafeAreaView style={styles.safeLight}><ErrorState error={room.error} onRetry={room.reload} /><Button label={t('common.back')} variant="ghost" onPress={() => router.back()} /></SafeAreaView>;
  if (!room.access) return <SafeAreaView style={styles.safeLight}><ScreenSkeleton /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* الشريط العلوي */}
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text role="bodyMedium" color={colors.text.onPrimary} numberOfLines={1}>{b?.subject.name} · {otherName}</Text>
          <Text role="caption" color={colors.text.onPrimary} tabular style={styles.dim}>{formatTime(b!.startsAt)}–{formatTime(b!.endsAt)} · {t('lessons.room.elapsed')} {mmss(elapsed)} · −{mmss(remaining)}</Text>
        </View>
        <View style={[styles.conn, st.connection === 'connected' ? styles.connOk : st.connection === 'reconnecting' ? styles.connWarn : styles.connBad]}>
          <Icon name={st.connection === 'connected' ? 'wifi' : 'wifiOff'} size={14} color={colors.text.onPrimary} />
          <Text role="caption" color={colors.text.onPrimary}>{st.connection === 'connected' ? t('live.connected') : st.connection === 'reconnecting' ? t('lessons.room.reconnecting') : st.connection === 'ended' ? t('lessons.room.ended') : t('live.failed')}</Text>
        </View>
      </View>

      {/* الفيديو */}
      <View style={styles.stage}>
        <VideoTile stream={room.remote} name={otherName} large camOff={!room.remote || other?.cam === false} micOff={other?.mic === false}
          note={!other ? t('live.waitingOther') : Platform.OS !== 'web' ? t('live.nativeVideoNote') : !room.remote ? t('lessons.room.reconnecting') : null} />
        <View style={styles.pip}><VideoTile stream={room.local} local name={t('live.you')} camOff={!st.cam} micOff={!st.mic} /></View>
        {st.mediaError ? (
          <View style={styles.mediaBanner}>
            <Icon name="cameraOff" size={16} color={colors.text.onPrimary} />
            <Text role="caption" color={colors.text.onPrimary} style={styles.flex}>{t(st.mediaError)}</Text>
            <Button label={t('live.mediaRetry')} size="sm" variant="secondary" onPress={room.retryMedia} />
          </View>
        ) : null}
        {st.sharing || st.remoteSharing ? <View style={styles.shareBanner}><Icon name="screen" size={14} color={colors.text.onPrimary} /><Text role="caption" color={colors.text.onPrimary}>{t('live.sharing')}</Text></View> : null}
        {st.participants.some(p => p.hand && p.userId !== st.me?.userId) ? <View style={styles.handBanner}><Icon name="hand" size={14} color={colors.text.primary} /><Text role="caption">{st.participants.filter(p => p.hand && p.userId !== st.me?.userId).map(p => p.name).join('، ')} {t('live.handRaised')}</Text></View> : null}
      </View>

      {/* أزرار التحكّم — تتّسع كاملةً على شاشة 390: الأساسية دائماً ظاهرة (المغادرة وإنهاء الحصة منها) والباقي في ورقة «المزيد» */}
      <View style={styles.controls}>
        {ctl(st.mic ? 'mic' : 'micOff', st.mic ? t('lessons.room.mute') : t('lessons.room.unmute'), room.toggleMic, { active: !st.mic, disabled: !room.local })}
        {ctl(st.cam ? 'video' : 'cameraOff', t('lessons.room.camera'), room.toggleCam, { active: !st.cam, disabled: !room.local })}
        {ctl('chat', t('lessons.room.chat'), () => setSheet('chat'), { badge: st.unread })}
        {ctl('more', t('common.more'), () => setSheet('more'), { active: st.hand || st.sharing, badge: st.boardOps.length || undefined })}
        {st.me?.isHost ? ctl('end', t('live.endLesson'), () => setDialog('end'), { danger: true }) : null}
        {ctl('leave', t('lessons.room.leave'), () => setDialog('leave'), { danger: true })}
      </View>

      {/* المزيد: اليد، المشاركون، السبّورة، مشاركة الشاشة */}
      <BottomSheet visible={sheet === 'more'} onClose={() => setSheet(null)} title={t('common.more')}>
        <View style={styles.moreList}>
          <Button label={t('lessons.room.raiseHand')} icon="hand" variant={st.hand ? 'primary' : 'secondary'} full onPress={room.toggleHand} />
          <Button label={`${t('lessons.room.participants')} (${st.participants.length})`} icon="people" variant="secondary" full onPress={() => setSheet('people')} />
          <Button label={t('lessons.room.whiteboard')} icon="board" variant="secondary" full onPress={() => setSheet('board')} />
          <Button label={st.sharing ? t('live.stopSharing') : t('lessons.room.share')} icon="screen" variant="secondary" full disabled={!room.webrtc} onPress={room.toggleShare} />
        </View>
      </BottomSheet>

      {/* الدردشة */}
      <BottomSheet visible={sheet === 'chat'} onClose={() => setSheet(null)} title={t('lessons.room.chat')}
        footer={<View style={styles.chatRow}><View style={styles.flex}><Input value={text} onChangeText={setText} placeholder={t('lessons.room.typeMessage')} onSubmitEditing={async () => { if (text.trim() && await room.sendChat(text.trim())) setText(''); }} returnKeyType="send" /></View><Button label={t('ui.send')} icon="send" onPress={async () => { if (text.trim() && await room.sendChat(text.trim())) setText(''); }} disabled={!text.trim()} /></View>}>
        {st.messages.length === 0 ? <Text role="small" tone="tertiary" center>{t('live.noMessages')}</Text> : st.messages.map(m => (
          <View key={m.id} style={[styles.msg, m.userId === st.me?.userId && styles.msgMine]}>
            <Text role="caption" tone={m.userId === st.me?.userId ? 'brand' : 'secondary'}>{m.userId === st.me?.userId ? t('live.you') : m.name} · {formatTime(m.at)}</Text>
            <Text role="body">{m.body}</Text>
          </View>
        ))}
      </BottomSheet>

      {/* المشاركون */}
      <BottomSheet visible={sheet === 'people'} onClose={() => setSheet(null)} title={t('live.participantsN', { n: st.participants.length })}>
        {st.participants.map(p => (
          <View key={p.userId} style={styles.person}>
            <Avatar name={p.name} size="sm" />
            <View style={styles.flex}><Text role="bodyMedium">{p.name}{p.userId === st.me?.userId ? ` (${t('live.you')})` : ''}</Text><Text role="caption" tone="secondary">{p.isHost ? t('live.host') : t('onboarding.student')}</Text></View>
            {p.hand ? <Icon name="hand" size={18} color={colors.brand.gold} /> : null}
            {p.mic === false ? <Icon name="micOff" size={18} color={colors.text.tertiary} /> : null}
            {st.me?.isHost && p.userId !== st.me.userId && p.mic !== false ? <Button label={t('lessons.room.mute')} size="sm" variant="ghost" onPress={() => room.muteUser(p.userId)} /> : null}
          </View>
        ))}
      </BottomSheet>

      {/* السبّورة */}
      <BottomSheet visible={sheet === 'board'} onClose={() => setSheet(null)} title={t('lessons.room.whiteboard')}>
        <Text role="caption" tone="secondary" style={styles.hint}>{t('live.boardHint')}</Text>
        <Whiteboard ops={st.boardOps} onStroke={room.boardStroke} onClear={st.me?.isHost ? room.boardClear : undefined} canDraw />
      </BottomSheet>

      <Dialog visible={dialog === 'leave'} onClose={() => setDialog(null)} title={t('live.leaveConfirm')} actions={<><Button label={t('live.stay')} variant="secondary" onPress={() => setDialog(null)} /><Button label={t('live.yesLeave')} variant="danger" onPress={exit} /></>} />
      <Dialog visible={dialog === 'end'} onClose={() => setDialog(null)} title={t('live.endLesson')} body={t('live.confirmEnd')} actions={<><Button label={t('common.cancel')} variant="secondary" onPress={() => setDialog(null)} /><Button label={t('live.endLesson')} variant="danger" onPress={() => { setDialog(null); room.endLesson(); }} /></>} />
      <Dialog visible={ended} onClose={afterEnd} title={t('live.lessonEnded')} body={t('live.endedBody')} actions={<Button label={st.me?.role === 'teacher' ? t('teacherUi.notes') : t('lessons.post.rate')} onPress={afterEnd} />} />
      {st.connection === 'failed' ? <Dialog visible onClose={exit} title={t('live.failed')} body={t(st.failReason ?? 'errors.contentUnavailable')} actions={<><Button label={t('common.back')} variant="secondary" onPress={exit} /><Button label={t('live.retry')} onPress={room.reload} /></>} /> : null}
    </SafeAreaView>
  );
}

const styles = themed((c) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#141210' },
  safeLight: { flex: 1, backgroundColor: c.bg.base, padding: spacing[4], justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  flex: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.75 },
  conn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full },
  connOk: { backgroundColor: c.state.success }, connWarn: { backgroundColor: c.state.warning }, connBad: { backgroundColor: c.state.danger },
  stage: { flex: 1, marginHorizontal: spacing[3], borderRadius: radius.lg, overflow: 'hidden' },
  pip: { position: 'absolute', bottom: spacing[3], end: spacing[3], width: 120, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' },
  shareBanner: { position: 'absolute', top: spacing[3], start: spacing[3], flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: c.state.info, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  /** تعذّر الكاميرا/المايك — شريط فوق المسرح لا رسالة صامتة؛ المسرح داكن دائماً فنصّه أبيض ثابت */
  mediaBanner: { position: 'absolute', top: spacing[3], insetInlineStart: spacing[3], insetInlineEnd: spacing[3],
    flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2], paddingHorizontal: spacing[3],
    borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.72)' },
  handBanner: { position: 'absolute', top: spacing[3], end: spacing[3], flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: c.brand.goldSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  controls: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
  moreList: { gap: spacing[2] },
  // flex بدل عرض ثابت: ستة أزرار تتقاسم عرض الشاشة بلا تمرير أفقي يخفي «مغادرة»
  ctl: { flex: 1, minWidth: 0, height: hitTarget + 20, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', gap: 2 },
  ctlActive: { backgroundColor: c.bg.card },
  ctlDanger: { backgroundColor: c.state.danger },
  ctlDisabled: { opacity: 0.4 },
  ctlLabel: { fontSize: 10, lineHeight: 12 },
  badge: { position: 'absolute', top: 4, end: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.brand.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { fontSize: 10, lineHeight: 12 },
  chatRow: { flexDirection: 'row', gap: spacing[2], alignItems: 'flex-end' },
  msg: { backgroundColor: c.bg.subtle, borderRadius: radius.md, padding: spacing[3], marginBottom: spacing[2], alignSelf: 'flex-start', maxWidth: '88%' },
  msgMine: { backgroundColor: c.brand.primarySoft, alignSelf: 'flex-end' },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.default },
  hint: { marginBottom: spacing[2] },
}));
