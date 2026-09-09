/**
 * القاعة المباشرة — عميل:
 *  ١) رمز الدخول من الخادم (حجز رسمي فقط)   ٢) Socket.IO: حضور/دردشة/يد/سبّورة/مشاركة
 *  ٣) الفيديو: على الويب WebRTC نظير-لنظير بإشارات عبر الخادم؛ على الجوال يتطلّب نسخة مبنية (LiveKit) — موثّق لا مخفيّ.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { RoomAccess } from '@manassah/shared';
import { api, isDemo } from '@/api/client';
import { createDemoSocket } from '@/api/demo';
import { tokens } from '@/state/auth';
import { useRoom, type Participant, type RoomMessage } from '@/state/room';

type Signal = { type: 'offer' | 'answer'; sdp: string } | { type: 'ice'; candidate: RTCIceCandidateInit };
const hasWebRtc = () => Platform.OS === 'web' && typeof RTCPeerConnection !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices;
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export function useLiveRoom(bookingId: number) {
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const socket = useRef<Socket | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const peer = useRef<number | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  /** معرّف الطرف الآخر في الحجز — الغرفة ثنائية، وحساب إدارة قد يدخل بصفة مضيف فلا يُتفاوَض معه أصلاً */
  const counterpart = useRef<number | null>(null);
  /** مؤقّتات عرض التفاوض المؤجّلة — تُلغى عند التفكيك حتى لا يُنشأ اتصال نظير بعد المغادرة فيبقى مفتوحاً */
  const offerTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /* ---------- ١) الرمز ---------- */
  const load = useCallback(() => {
    useRoom.getState().reset();
    setError(null);
    api.get(`/bookings/${bookingId}/room`, RoomAccess).then(setAccess).catch(setError);
  }, [bookingId]);
  useEffect(() => { load(); }, [load]);

  /* ---------- ٣) الوسائط (ويب) ---------- */
  /** عدّاد إعادة المحاولة: بعد السماح بالإذن من شريط المتصفّح لا حدث يخبرنا، فالمستخدم يطلب المحاولة ثانيةً */
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const retryMedia = useCallback(() => { useRoom.getState().set({ mediaError: null }); setMediaAttempt(n => n + 1); }, []);
  useEffect(() => {
    if (!access || !hasWebRtc()) return;
    let stopped = false;
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: true })
      .then(s => { if (stopped) { s.getTracks().forEach(t => t.stop()); return; } localRef.current = s; setLocal(s); })
      // رفض الإذن: نصحّح ما أُعلن في الترحيب (الافتراضي مفتوح) وإلا ظننا الطرف الآخر أنّ كاميرتنا ومايكنا يعملان،
      // ونُسمّي السبب للمستخدم — ابتلاعه كان يترك مربّعاً بلا صورة وزرَّين معطَّلين بلا تفسير
      .catch((e: unknown) => {
        const name = (e as { name?: string } | null)?.name ?? '';
        const key = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError' ? 'live.mediaDenied'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' ? 'live.mediaMissing'
          : name === 'NotReadableError' || name === 'TrackStartError' ? 'live.mediaBusy'
          : 'live.mediaFailed';
        useRoom.getState().set({ cam: false, mic: false, mediaError: key });
        socket.current?.emit('media:state', { mic: false, cam: false });
      });
    return () => { stopped = true; localRef.current?.getTracks().forEach(t => t.stop()); screenRef.current?.getTracks().forEach(t => t.stop()); localRef.current = null; screenRef.current = null; setLocal(null); };
  }, [access, mediaAttempt]);

  const emit = useCallback((event: string, ...args: unknown[]) => socket.current?.emit(event, ...args), []);

  const closePeer = useCallback(() => { pc.current?.close(); pc.current = null; peer.current = null; setRemote(null); }, []);

  /** لا نطمس «انتهت الحصة»: بعدها يقطع الخادم المقابس فلا معنى لعرض «إعادة الاتصال» فوق نافذة الانتهاء */
  const setConnection = useCallback((c: 'connected' | 'reconnecting') => { if (useRoom.getState().connection !== 'ended') useRoom.getState().set({ connection: c }); }, []);

  /** إعادة تشغيل ICE بعد انقطاع المسار — المضيف وحده يعيد العرض حتى لا يتصادم الطرفان */
  const restartIce = useCallback(async (target: number) => {
    const conn = pc.current;
    if (!conn || peer.current !== target || conn.signalingState === 'closed') return;
    try {
      const offer = await conn.createOffer({ iceRestart: true });
      await conn.setLocalDescription(offer);
      emit('rtc:signal', { to: target, data: { type: 'offer', sdp: offer.sdp! } satisfies Signal });
    } catch (e) { if (__DEV__) console.warn('[rtc]', e); }
  }, [emit]);

  const ensurePeer = useCallback((target: number) => {
    if (pc.current && peer.current === target) return pc.current;
    closePeer();
    const conn = new RTCPeerConnection({ iceServers: (access?.iceServers as RTCIceServer[] | undefined) ?? ICE });
    peer.current = target; pc.current = conn;
    localRef.current?.getTracks().forEach(t => conn.addTrack(t, localRef.current!));
    // مشاركة جارية قبل وصول الطرف الآخر: المُرسَل هو الشاشة لا الكاميرا، وإلا رأى كاميرتي رغم لافتة المشاركة
    const shared = screenRef.current?.getVideoTracks()[0];
    if (shared) {
      const sender = conn.getSenders().find(x => x.track?.kind === 'video');
      if (sender) sender.replaceTrack(shared).catch(() => {}); else conn.addTrack(shared, screenRef.current!);
    }
    conn.onicecandidate = e => { if (e.candidate) emit('rtc:signal', { to: target, data: { type: 'ice', candidate: e.candidate.toJSON() } satisfies Signal }); };
    conn.ontrack = e => { setRemote(e.streams[0] ?? null); };
    // 'disconnected' مثل 'failed': بدونها تبقى آخر صورة مجمّدة والشارة «متصل» إلى الأبد
    conn.onconnectionstatechange = () => {
      if (pc.current !== conn) return;
      const cs = conn.connectionState;
      if (cs === 'connected') return setConnection('connected');
      if (cs !== 'failed' && cs !== 'disconnected') return;
      setConnection('reconnecting'); setRemote(null);
      if (!useRoom.getState().me?.isHost) return;
      offerTimers.current.push(setTimeout(() => {
        if (socket.current && pc.current === conn && (conn.connectionState === 'failed' || conn.connectionState === 'disconnected')) restartIce(target);
      }, 2000));
    };
    return conn;
  }, [access, closePeer, emit, restartIce, setConnection]);

  const offerTo = useCallback(async (target: number) => {
    const conn = ensurePeer(target);
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    emit('rtc:signal', { to: target, data: { type: 'offer', sdp: offer.sdp! } satisfies Signal });
  }, [ensurePeer, emit]);

  const onSignal = useCallback(async ({ from, data }: { from: number; data: Signal }) => {
    if (!hasWebRtc()) return;
    // إشارة من غير طرفَي الحجز (حساب إدارة يدخل بصفة مضيف) كانت تهدم اتصال المعلّم بالطالب — تُتجاهل
    if (counterpart.current !== null && from !== counterpart.current) return;
    try {
      if (data.type === 'offer') {
        const conn = ensurePeer(from);
        await conn.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        emit('rtc:signal', { to: from, data: { type: 'answer', sdp: answer.sdp! } satisfies Signal });
      } else if (data.type === 'answer' && pc.current) {
        await pc.current.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      } else if (data.type === 'ice' && pc.current) {
        await pc.current.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (e) { if (__DEV__) console.warn('[rtc]', e); }
  }, [ensurePeer, emit]);

  /* ---------- ٢) Socket.IO ---------- */
  useEffect(() => {
    if (!access) return;
    const set = useRoom.getState().set;
    const b = access.booking;
    const s: Socket = isDemo()
      ? (createDemoSocket(access.isHost, access.isHost ? b.student.name : b.teacher.name, access.isHost ? b.teacher.name : b.student.name) as unknown as Socket)
      : io(`${api.base}${access.realtimeNamespace}`, {
        auth: access.provider === 'internal' ? { roomToken: access.token } : { token: tokens.access, bookingId },
        transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 800, reconnectionDelayMax: 5000, timeout: 8000,
      });
    socket.current = s;
    /** الغرفة انتهت: نوقف إعادة المحاولة فوراً — الخادم يقطع المقابس بعد room:ended فتظلّ الشاشة تومض بين «انتهت» و«إعادة الاتصال» */
    const roomEnded = () => { if (!isDemo()) s.io.reconnection(false); set({ connection: 'ended' }); closePeer(); };
    /** الطرف الوحيد الذي نتفاوض معه — من الحجز لا من قائمة الحضور (قد تضمّ حساب إدارة بصفة مضيف) */
    const otherOf = (list: Participant[], meId?: number) => {
      const id = meId === b.teacher.id ? b.student.id : meId === b.student.id ? b.teacher.id : null;
      return list.find(p => (id !== null ? p.userId === id : p.userId !== meId)) ?? null;
    };
    s.on('connect', () => set({ connection: 'connected', failReason: null }));
    // 'failed' نهائيّ مثل 'ended' (انتُزعت الغرفة من جهاز آخر، أو رمز غير صالح): الخادم يقطع المقبس بعده مباشرة،
    // فوضع 'reconnecting' فوقه كان يطمس الرسالة ويترك الشاشة على «جارٍ إعادة الاتصال…» إلى الأبد
    s.on('disconnect', () => { const c = useRoom.getState().connection; if (c !== 'ended' && c !== 'failed') set({ connection: 'reconnecting' }); });
    s.on('connect_error', (e: Error) => { if (e.message === 'room_closed') return roomEnded(); set({ connection: e.message === 'room_token_invalid' ? 'failed' : 'reconnecting' }); });
    s.on('room:welcome', (w: { you: { userId: number; isHost: boolean; role: 'student' | 'teacher' | 'observer' }; participants: Participant[]; messages: RoomMessage[] }) => {
      counterpart.current = w.you.userId === b.teacher.id ? b.student.id : w.you.userId === b.student.id ? b.teacher.id : null;
      set({ me: w.you, participants: w.participants, messages: w.messages, connection: 'connected', startedAt: useRoom.getState().startedAt ?? Date.now() });
      emit('media:state', { mic: useRoom.getState().mic, cam: useRoom.getState().cam });
      // المضيف يبدأ الاتصال المرئي مع الطرف الآخر إن كان حاضراً
      const other = otherOf(w.participants, w.you.userId);
      if (w.you.isHost && other && hasWebRtc() && !isDemo()) offerTimers.current.push(setTimeout(() => { if (socket.current) offerTo(other.userId); }, 300));
    });
    s.on('presence', (list: Participant[]) => {
      const me = useRoom.getState().me;
      set({ participants: list });
      const other = otherOf(list, me?.userId);
      if (!other) closePeer();
      else if (me?.isHost && hasWebRtc() && !isDemo() && peer.current !== other.userId) offerTimers.current.push(setTimeout(() => {
        if (!socket.current) return;
        offerTo(other.userId);
        // القادم متأخّراً لا يعرف بمشاركة جارية: share:state لا يُبثّ إلا لحظة الضغط
        if (useRoom.getState().sharing) emit('share:state', { sharing: true });
      }, 300));
    });
    s.on('chat:message', (m: RoomMessage) => useRoom.getState().addMessage(m, m.userId === useRoom.getState().me?.userId));
    s.on('room:ended', roomEnded);
    // الخادم يُبقي مقبساً واحداً لكل مستخدم في الغرفة: التبويب الأقدم يُفصل ولا يُعيد المحاولة، وإلا تنازعا الاتصال بلا نهاية
    s.on('room:takenOver', () => { if (!isDemo()) s.io.reconnection(false); set({ connection: 'failed', failReason: 'live.takenOver' }); closePeer(); });
    s.on('whiteboard:op', ({ op }: { op: unknown }) => useRoom.getState().addBoardOp(op));
    s.on('whiteboard:clear', () => set({ boardOps: [] }));
    // المشاركة تصل الآن من أي مشارك ومعها صاحبها — لا نعرض إلا مشاركة الطرف الآخر من الحجز (حساب الإدارة مراقب)
    s.on('share:state', (st: { userId?: number; sharing?: boolean }) => { if (st?.userId !== undefined && counterpart.current !== null && st.userId !== counterpart.current) return; set({ remoteSharing: !!st?.sharing }); });
    // دمج المُرسَل فقط: البثّ جزئي ({mic} أو {cam})، ونسخ الحقل الغائب كان يمحو ما نعرفه عن الطرف الآخر
    s.on('media:state', ({ userId, mic, cam }: { userId: number; mic?: boolean; cam?: boolean }) => set({ participants: useRoom.getState().participants.map(p => p.userId === userId ? { ...p, ...(mic === undefined ? {} : { mic }), ...(cam === undefined ? {} : { cam }) } : p) }));
    s.on('mute:request', ({ targetUserId }: { targetUserId: number }) => { if (targetUserId === useRoom.getState().me?.userId) { localRef.current?.getAudioTracks().forEach(t => { t.enabled = false; }); set({ mic: false }); emit('media:state', { mic: false }); } });
    s.on('rtc:signal', onSignal);
    return () => { for (const id of offerTimers.current) clearTimeout(id); offerTimers.current = []; counterpart.current = null; s.removeAllListeners(); s.close(); socket.current = null; closePeer(); };
  }, [access, bookingId, emit, offerTo, onSignal, closePeer]);

  /* ---------- أفعال ---------- */
  // بلا مسار حقيقي (رفض الإذن أو نسخة بلا WebRTC) لا نقلب الأيقونة ولا نخبر الطرف الآخر أنّ المايك/الكاميرا يعملان
  const toggleMic = useCallback(() => { const tracks = localRef.current?.getAudioTracks() ?? []; if (!tracks.length) return; const on = !useRoom.getState().mic; tracks.forEach(t => { t.enabled = on; }); useRoom.getState().set({ mic: on }); emit('media:state', { mic: on }); }, [emit]);
  const toggleCam = useCallback(() => { const tracks = localRef.current?.getVideoTracks() ?? []; if (!tracks.length) return; const on = !useRoom.getState().cam; tracks.forEach(t => { t.enabled = on; }); useRoom.getState().set({ cam: on }); emit('media:state', { cam: on }); }, [emit]);
  const toggleHand = useCallback(() => { const raised = !useRoom.getState().hand; useRoom.getState().set({ hand: raised }); emit('hand:toggle', raised); }, [emit]);
  const sendChat = useCallback((body: string) => new Promise<boolean>(res => { if (!socket.current) return res(false); socket.current.emit('chat:send', { body }, (r: { ok: boolean }) => res(!!r?.ok)); }), []);
  const boardStroke = useCallback((op: unknown) => { useRoom.getState().addBoardOp(op); emit('whiteboard:op', op); }, [emit]);
  const boardClear = useCallback(() => { useRoom.getState().set({ boardOps: [] }); emit('whiteboard:clear'); }, [emit]);
  const muteUser = useCallback((userId: number) => emit('mute:request', userId), [emit]);
  const endLesson = useCallback(() => emit('room:end'), [emit]);
  const leave = useCallback(() => { socket.current?.close(); closePeer(); }, [closePeer]);

  const toggleShare = useCallback(async () => {
    if (!hasWebRtc()) return;
    const sender = pc.current?.getSenders().find(x => x.track?.kind === 'video');
    // الفرع من التقاطي أنا لا من حالة مشتركة: مشاركة الطرف الآخر كانت تُصفّر العلم فأبدأ التقاطاً ثانياً ويبقى الأوّل حيّاً بلا مُرسِل
    if (screenRef.current) {
      screenRef.current.getTracks().forEach(t => t.stop()); screenRef.current = null;
      const cam = localRef.current?.getVideoTracks()[0]; if (cam && sender) await sender.replaceTrack(cam);
      useRoom.getState().set({ sharing: false }); emit('share:state', { sharing: false }); return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      // ضغطتان متسارعتان: نوقف أيّ التقاط أُسند أثناء انتظار المستخدم حتى لا يبقى حيّاً بلا مُرسِل
      const stale = screenRef.current as MediaStream | null;
      stale?.getTracks().forEach(t => t.stop());
      screenRef.current = screen;
      const track = screen.getVideoTracks()[0];
      if (sender) await sender.replaceTrack(track);
      track.onended = () => { toggleShare(); };
      useRoom.getState().set({ sharing: true }); emit('share:state', { sharing: true });
    } catch { /* رفض المستخدم */ }
  }, [emit]);

  return { access, error, reload: load, local, remote, toggleMic, toggleCam, toggleHand, sendChat, boardStroke, boardClear, muteUser, endLesson, leave, toggleShare, retryMedia, webrtc: hasWebRtc() };
}
