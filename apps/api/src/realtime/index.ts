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
interface RoomData { userId: number; name: string; isHost: boolean; bookingId: number; roomRowId: number; role: 'student' | 'teacher'; hand: boolean; joinedAt: string }

export function attachRealtime(server: HttpServer) {
  const io = new Server(server, { cors: { origin: config.security.corsOrigins.length ? config.security.corsOrigins : true, credentials: true }, path: '/socket.io' });
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
    let userId: number | null = null, isHost = false, name = '', roomRow: any = null;
    if (auth.roomToken) {
      const v = verifyInternalRoomToken(String(auth.roomToken));
      if (!v) return next(new Error('room_token_invalid'));
      userId = v.userId; isHost = v.isHost; name = v.name;
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
    const role: 'student' | 'teacher' = booking.teacher_id === userId ? 'teacher' : 'student';
    isHost = isHost || role === 'teacher';
    socket.data = { userId, name, isHost, bookingId: roomRow.booking_id, roomRowId: roomRow.id, role, hand: false, joinedAt: nowIso() } satisfies RoomData;
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
    socket.on('share:state', (state: unknown) => { if (d.isHost) socket.to(key).emit('share:state', state); });
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
      for (const s of rooms.adapter.rooms.get(key) ?? []) { const o = rooms.sockets.get(s)?.data as RoomData | undefined; if (o) markLeft(o.bookingId, o.userId); }
      endRoom(d.bookingId);
      completeBooking(d.bookingId);
      rooms.to(key).emit('room:ended', { by: d.userId });
      rooms.in(key).disconnectSockets(true);
    });
    socket.on('disconnect', () => {
      const stillHere = [...(rooms.adapter.rooms.get(key) ?? [])].some(s => (rooms.sockets.get(s)?.data as RoomData | undefined)?.userId === d.userId);
      if (!stillHere) { markLeft(d.bookingId, d.userId); q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', d.userId, 'room_disconnect', JSON.stringify({ bookingId: d.bookingId })); }
      socket.to(key).emit('presence', presence(key));
    });
  });

  return io;
}
