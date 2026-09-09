import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config } from '../config.ts';
import { q, nowIso } from '../db/index.ts';
import { verifyAccessToken, loadUser } from '../lib/auth.ts';
import { verifyInternalRoomToken, endRoom } from '../services/rooms.ts';
import { markJoined, markLeft, completeBooking } from '../services/bookings.ts';
import { bindIo } from '../services/notifications.ts';

/**
 * Socket.IO:
 *  /       → إشعارات فورية لكل مستخدم (غرفة user:id)
 *  /room   → الحصة المباشرة: حضور، دردشة، يد، سبّورة، مشاركة، مؤقّت — بلا رابط عام؛
 *            الدخول برمز الغرفة الصادر من حجز رسمي، ويُسجَّل الحضور والانقطاع وإعادة الاتصال.
 */
/** observer = حساب إدارة يراقب: لا حضور يُسجَّل له ولا صفة مضيف — الحصة بين طرفَي الحجز وحدهما */
interface RoomData { userId: number; name: string; isHost: boolean; bookingId: number; roomRowId: number; role: 'student' | 'teacher' | 'observer'; hand: boolean; joinedAt: string }

let ioRef: Server | null = null;
/** بثّ حدث لكل أجهزة مستخدم (غرفة user:<id>) — مثل session_revoked عند الإيقاف أو إنهاء الجلسات من الإدارة */
export const emitToUser = (userId: number, event: string, payload?: unknown) => { ioRef?.to(`user:${userId}`).emit(event, payload); };
/** عدد المقابس المتصلة الآن (للنظرة الحيّة في الإدارة) */
export const connectedSockets = (): number => ioRef?.engine?.clientsCount ?? 0;

/**
 * مصافحات Socket.IO لا تمرّ بأي وسيط من express: engine.io يلتقط /socket.io قبل مُحدِّد المعدّل،
 * فبلا عدّاد هنا يفتح عميل واحد آلاف المصافحات (كلٌّ منها تحقّق رمز وقراءة قاعدة) على الخادم مباشرة.
 */
const HANDSHAKES_PER_MINUTE = 60;
const handshakes = new Map<string, { count: number; resetAt: number }>();
function allowHandshake(ip: string): boolean {
  if (!config.rateLimit.enabled) return true;
  const now = Date.now();
  // الخريطة تنمو بعدد العناوين: نكنس المنتهية عند التضخّم حتى لا تصير تسريب ذاكرة
  if (handshakes.size > 5_000) for (const [k, v] of handshakes) if (now > v.resetAt) handshakes.delete(k);
  const cur = handshakes.get(ip);
  if (!cur || now > cur.resetAt) { handshakes.set(ip, { count: 1, resetAt: now + 60_000 }); return true; }
  cur.count++;
  return cur.count <= HANDSHAKES_PER_MINUTE;
}
/** خلف وسيط موثوق فقط نصدّق X-Forwarded-For، وإلا زوّرها كلُّ عميل وأفلت من العدّاد */
const handshakeIp = (req: { headers: Record<string, unknown>; socket: { remoteAddress?: string } }): string =>
  (config.security.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';

export function attachRealtime(server: HttpServer) {
  const io = new Server(server, {
    cors: { origin: config.security.corsOrigins.length ? config.security.corsOrigins : true, credentials: true },
    path: '/socket.io',
    // رسائل الغرفة نصّ ولوح وإشارات WebRTC — مئة كيلوبايت تكفيها، والافتراضي (ميغابايت) يجعل كل مقبس بوّابة رفع
    maxHttpBufferSize: 100_000,
    // انقطاع صامت (شبكة جوال، إغلاق تبويب بلا إشعار) يجب أن يظهر في الحضور خلال ثوانٍ لا عشرينها
    pingInterval: 20_000,
    pingTimeout: 10_000,
    allowRequest: (req, cb) => cb(null, allowHandshake(handshakeIp(req as never))),
  });
  ioRef = io;
  bindIo(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const p = token ? verifyAccessToken(token) : null;
    const user = p ? loadUser(Number(p.sub)) : null;
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    next();
  });
  io.on('connection', socket => { socket.join(`user:${socket.data.userId}`); });

  const rooms = io.of('/room');
  rooms.use((socket, next) => {
    const auth = socket.handshake.auth ?? {};
    // صفة المضيف تُستنتج من الحجز أدناه لا من الرمز — رمز يحمل isHost لغير المعلّم لا يمنحها
    let userId: number | null = null, name = '', roomRow: any = null;
    if (auth.roomToken) {
      const v = verifyInternalRoomToken(String(auth.roomToken));
      if (!v) return next(new Error('room_token_invalid'));
      userId = v.userId; name = v.name;
      roomRow = q.get<any>('SELECT * FROM live_rooms WHERE provider_room_id = ?', v.room);
    } else if (auth.token && auth.bookingId) {
      // مزوّد فيديو خارجي: نتحقّق من أن المستخدم أُصدر له رمز للغرفة ولم ينتهِ
      const p = verifyAccessToken(String(auth.token));
      if (!p) return next(new Error('unauthorized'));
      userId = Number(p.sub);
      roomRow = q.get<any>('SELECT * FROM live_rooms WHERE booking_id = ?', Number(auth.bookingId));
      const part = roomRow && q.get<any>('SELECT 1 FROM room_participants WHERE room_id = ? AND user_id = ? AND token_expires_at > ?', roomRow.id, userId, Math.floor(Date.now() / 1000));
      if (!part) return next(new Error('room_token_invalid'));
      name = q.val<string>('SELECT display_name FROM profiles WHERE user_id = ?', userId) ?? '';
    } else return next(new Error('unauthorized'));
    if (!roomRow || roomRow.status === 'ended') return next(new Error('room_closed'));
    if (Date.now() > new Date(roomRow.closes_at).getTime()) return next(new Error('room_closed'));
    const booking = q.get<any>('SELECT student_id, teacher_id, status FROM bookings WHERE id = ?', roomRow.booking_id);
    if (!booking || !['confirmed', 'in_progress'].includes(booking.status)) return next(new Error('room_closed'));
    // من ليس طرفاً في الحجز (إدارة أو دعم) مراقب: تسجيله «طالباً» كان يكتب له حضوراً ويقلب الحجز إلى in_progress
    const role: RoomData['role'] = booking.teacher_id === userId ? 'teacher' : booking.student_id === userId ? 'student' : 'observer';
    socket.data = { userId, name, isHost: role === 'teacher', bookingId: roomRow.booking_id, roomRowId: roomRow.id, role, hand: false, joinedAt: nowIso() } satisfies RoomData;
    next();
  });

  const presence = (roomKey: string) => {
    const list: any[] = [];
    for (const s of rooms.adapter.rooms.get(roomKey) ?? []) {
      const d = rooms.sockets.get(s)?.data as RoomData | undefined;
      if (d && !list.some(x => x.userId === d.userId)) list.push({ userId: d.userId, name: d.name, isHost: d.isHost, role: d.role, hand: d.hand, joinedAt: d.joinedAt });
    }
    return list;
  };

  rooms.on('connection', (socket: Socket) => {
    const d = socket.data as RoomData;
    const key = `room:${d.roomRowId}`;
    socket.join(key);
    // مقبس واحد لكل مستخدم في الغرفة: التبويب الثاني كان يُطوى في الحضور (يُزال تكراره بالمعرّف) فلا يُعرض عليه
    // أحد، وrtc:signal كان يُبثّ لكل مقابسه فيُفسد التفاوض — الأحدث يكسب والأقدم يُبلَّغ ويُفصل.
    // بعد الانضمام لا قبله: هكذا يجد المقبسُ الأقدم نفسَه «ما زال حاضراً» فلا يُغلق حضوره ولا يُحتسب انقطاعاً.
    for (const sid of rooms.adapter.rooms.get(key) ?? []) {
      const old = rooms.sockets.get(sid);
      if (old && old.id !== socket.id && (old.data as RoomData).userId === d.userId) {
        old.emit('room:takenOver', { reason: 'أنت متصل من جهاز آخر' });
        old.disconnect(true);
      }
    }
    if (d.role === 'student' || d.role === 'teacher') markJoined(d.bookingId, d.userId, d.role);
    socket.emit('room:welcome', {
      you: { userId: d.userId, isHost: d.isHost, role: d.role },
      participants: presence(key),
      messages: q.all<any>('SELECT m.id, m.user_id, p.display_name, m.body, m.created_at FROM room_messages m JOIN profiles p ON p.user_id = m.user_id WHERE m.room_id = ? ORDER BY m.id DESC LIMIT 100', d.roomRowId).reverse()
        .map(m => ({ id: m.id, userId: m.user_id, name: m.display_name, body: m.body, at: m.created_at })),
    });
    socket.to(key).emit('presence', presence(key));

    socket.on('chat:send', (payload: { body?: string }, ack?: (r: unknown) => void) => {
      const text = String(payload?.body ?? '').trim().slice(0, 1000);
      if (!text) return ack?.({ ok: false });
      const info = q.run('INSERT INTO room_messages (room_id, user_id, body) VALUES (?,?,?)', d.roomRowId, d.userId, text);
      const msg = { id: Number(info.lastInsertRowid), userId: d.userId, name: d.name, body: text, at: nowIso() };
      rooms.to(key).emit('chat:message', msg);
      ack?.({ ok: true, id: msg.id });
    });
    socket.on('hand:toggle', (raised: boolean) => { d.hand = !!raised; rooms.to(key).emit('presence', presence(key)); });
    socket.on('whiteboard:op', (op: unknown) => { socket.to(key).emit('whiteboard:op', { from: d.userId, op }); });
    socket.on('whiteboard:clear', () => { if (d.isHost) rooms.to(key).emit('whiteboard:clear'); });
    // مشاركة الشاشة ليست حكراً على المعلّم: الطالب يعرض حلّه، فالإشارة تمرّ من أي مشارك ومعها صاحبها
    // وuserId يُكتب بعد النشر لا قبله: مرسِلٌ يضعه في حمولته كان ينتحل مشاركة غيره
    socket.on('share:state', (state: { sharing?: boolean }) => { socket.to(key).emit('share:state', { sharing: !!state?.sharing, userId: d.userId }); });
    socket.on('timer:sync', (state: unknown) => { if (d.isHost) socket.to(key).emit('timer:sync', state); });
    socket.on('media:state', (state: { mic?: boolean; cam?: boolean }) => { socket.to(key).emit('media:state', { userId: d.userId, ...state }); });
    socket.on('mute:request', (targetUserId: number) => { if (d.isHost) rooms.to(key).emit('mute:request', { targetUserId }); });
    // إشارات WebRTC نظير-لنظير (المزوّد الداخلي): تُمرَّر للطرف الآخر فقط
    socket.on('rtc:signal', (payload: { to: number; data: unknown }) => {
      for (const s of rooms.adapter.rooms.get(key) ?? []) {
        const other = rooms.sockets.get(s);
        if (other && (other.data as RoomData).userId === payload?.to) other.emit('rtc:signal', { from: d.userId, data: payload.data });
      }
    });
    socket.on('room:end', () => {
      if (!d.isHost) return;
      markLeft(d.bookingId, d.userId);
      for (const s of rooms.adapter.rooms.get(key) ?? []) { const o = rooms.sockets.get(s)?.data as RoomData | undefined; if (o && o.role !== 'observer') markLeft(o.bookingId, o.userId); }
      endRoom(d.bookingId);
      completeBooking(d.bookingId);
      rooms.to(key).emit('room:ended', { by: d.userId });
      rooms.in(key).disconnectSockets(true);
    });
    socket.on('disconnect', () => {
      const stillHere = [...(rooms.adapter.rooms.get(key) ?? [])].some(s => (rooms.sockets.get(s)?.data as RoomData | undefined)?.userId === d.userId);
      if (!stillHere && d.role !== 'observer') { markLeft(d.bookingId, d.userId); q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', d.userId, 'room_disconnect', JSON.stringify({ bookingId: d.bookingId })); }
      socket.to(key).emit('presence', presence(key));
    });
  });

  return io;
}
