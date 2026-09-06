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

  /* ---------- ١) الرمز ---------- */
  const load = useCallback(() => {
    useRoom.getState().reset();
    setError(null);
    api.get(`/bookings/${bookingId}/room`, RoomAccess).then(setAccess).catch(setError);
  }, [bookingId]);
  useEffect(() => { load(); }, [load]);

  /* ---------- ٣) الوسائط (ويب) ---------- */
  useEffect(() => {
    if (!access || !hasWebRtc()) return;
    let stopped = false;
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: true })
      .then(s => { if (stopped) { s.getTracks().forEach(t => t.stop()); return; } localRef.current = s; setLocal(s); })
      .catch(() => useRoom.getState().set({ cam: false, mic: false }));
    return () => { stopped = true; localRef.current?.getTracks().forEach(t => t.stop()); screenRef.current?.getTracks().forEach(t => t.stop()); localRef.current = null; setLocal(null); };
  }, [access]);

  const emit = useCallback((event: string, ...args: unknown[]) => socket.current?.emit(event, ...args), []);

  const closePeer = useCallback(() => { pc.current?.close(); pc.current = null; peer.current = null; setRemote(null); }, []);

  const ensurePeer = useCallback((target: number) => {
    if (pc.current && peer.current === target) return pc.current;
    closePeer();
    const conn = new RTCPeerConnection({ iceServers: ICE });
    peer.current = target; pc.current = conn;
    localRef.current?.getTracks().forEach(t => conn.addTrack(t, localRef.current!));
    conn.onicecandidate = e => { if (e.candidate) emit('rtc:signal', { to: target, data: { type: 'ice', candidate: e.candidate.toJSON() } satisfies Signal }); };
    conn.ontrack = e => { setRemote(e.streams[0] ?? null); };
    conn.onconnectionstatechange = () => { if (conn.connectionState === 'failed') useRoom.getState().set({ connection: 'reconnecting' }); };
    return conn;
  }, [closePeer, emit]);

  const offerTo = useCallback(async (target: number) => {
    const conn = ensurePeer(target);
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    emit('rtc:signal', { to: target, data: { type: 'offer', sdp: offer.sdp! } satisfies Signal });
  }, [ensurePeer, emit]);

  const onSignal = useCallback(async ({ from, data }: { from: number; data: Signal }) => {
    if (!hasWebRtc()) return;
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
    s.on('connect', () => set({ connection: 'connected' }));
    s.on('disconnect', () => set({ connection: 'reconnecting' }));
    s.on('connect_error', (e: Error) => set({ connection: e.message === 'room_closed' ? 'ended' : e.message === 'room_token_invalid' ? 'failed' : 'reconnecting' }));
    s.on('room:welcome', (w: { you: { userId: number; isHost: boolean; role: 'student' | 'teacher' }; participants: Participant[]; messages: RoomMessage[] }) => {
      set({ me: w.you, participants: w.participants, messages: w.messages, connection: 'connected', startedAt: useRoom.getState().startedAt ?? Date.now() });
      emit('media:state', { mic: useRoom.getState().mic, cam: useRoom.getState().cam });
      // المضيف يبدأ الاتصال المرئي مع الطرف الآخر إن كان حاضراً
      const other = w.participants.find(p => p.userId !== w.you.userId);
      if (w.you.isHost && other && hasWebRtc() && !isDemo()) setTimeout(() => offerTo(other.userId), 300);
    });
    s.on('presence', (list: Participant[]) => {
      const me = useRoom.getState().me;
      set({ participants: list });
      const other = list.find(p => p.userId !== me?.userId);
      if (!other) closePeer();
      else if (me?.isHost && hasWebRtc() && !isDemo() && peer.current !== other.userId) setTimeout(() => offerTo(other.userId), 300);
    });
    s.on('chat:message', (m: RoomMessage) => useRoom.getState().addMessage(m, m.userId === useRoom.getState().me?.userId));
    s.on('room:ended', () => { set({ connection: 'ended' }); closePeer(); });
    s.on('whiteboard:op', ({ op }: { op: unknown }) => set({ boardOps: [...useRoom.getState().boardOps, op] }));
    s.on('whiteboard:clear', () => set({ boardOps: [] }));
    s.on('share:state', (st: { sharing?: boolean }) => set({ sharing: !!st?.sharing }));
    s.on('media:state', ({ userId, mic, cam }: { userId: number; mic?: boolean; cam?: boolean }) => set({ participants: useRoom.getState().participants.map(p => p.userId === userId ? { ...p, mic, cam } : p) }));
    s.on('mute:request', ({ targetUserId }: { targetUserId: number }) => { if (targetUserId === useRoom.getState().me?.userId) { localRef.current?.getAudioTracks().forEach(t => { t.enabled = false; }); set({ mic: false }); emit('media:state', { mic: false }); } });
    s.on('rtc:signal', onSignal);
    return () => { s.removeAllListeners(); s.close(); socket.current = null; closePeer(); };
  }, [access, bookingId, emit, offerTo, onSignal, closePeer]);

  /* ---------- أفعال ---------- */
  const toggleMic = useCallback(() => { const on = !useRoom.getState().mic; localRef.current?.getAudioTracks().forEach(t => { t.enabled = on; }); useRoom.getState().set({ mic: on }); emit('media:state', { mic: on }); }, [emit]);
  const toggleCam = useCallback(() => { const on = !useRoom.getState().cam; localRef.current?.getVideoTracks().forEach(t => { t.enabled = on; }); useRoom.getState().set({ cam: on }); emit('media:state', { cam: on }); }, [emit]);
  const toggleHand = useCallback(() => { const raised = !useRoom.getState().hand; useRoom.getState().set({ hand: raised }); emit('hand:toggle', raised); }, [emit]);
  const sendChat = useCallback((body: string) => new Promise<boolean>(res => { if (!socket.current) return res(false); socket.current.emit('chat:send', { body }, (r: { ok: boolean }) => res(!!r?.ok)); }), []);
  const boardStroke = useCallback((op: unknown) => { useRoom.getState().set({ boardOps: [...useRoom.getState().boardOps, op] }); emit('whiteboard:op', op); }, [emit]);
  const boardClear = useCallback(() => { useRoom.getState().set({ boardOps: [] }); emit('whiteboard:clear'); }, [emit]);
  const muteUser = useCallback((userId: number) => emit('mute:request', userId), [emit]);
  const endLesson = useCallback(() => emit('room:end'), [emit]);
  const leave = useCallback(() => { socket.current?.close(); closePeer(); }, [closePeer]);

  const toggleShare = useCallback(async () => {
    if (!hasWebRtc()) return;
    const sharing = useRoom.getState().sharing;
    const sender = pc.current?.getSenders().find(x => x.track?.kind === 'video');
    if (sharing) {
      screenRef.current?.getTracks().forEach(t => t.stop()); screenRef.current = null;
      const cam = localRef.current?.getVideoTracks()[0]; if (cam && sender) await sender.replaceTrack(cam);
      useRoom.getState().set({ sharing: false }); emit('share:state', { sharing: false }); return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenRef.current = screen;
      const track = screen.getVideoTracks()[0];
      if (sender) await sender.replaceTrack(track);
      track.onended = () => { toggleShare(); };
      useRoom.getState().set({ sharing: true }); emit('share:state', { sharing: true });
    } catch { /* رفض المستخدم */ }
  }, [emit]);

  return { access, error, reload: load, local, remote, toggleMic, toggleCam, toggleHand, sendChat, boardStroke, boardClear, muteUser, endLesson, leave, toggleShare, webrtc: hasWebRtc() };
}
