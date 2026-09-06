import jwt from 'jsonwebtoken';
import { config } from '../config.ts';
import { db, q, settings, nowIso } from '../db/index.ts';
import { AppError, notFound, forbidden } from '../lib/errors.ts';
import { sha256, randomToken, addMinutes } from '../lib/helpers.ts';
import type { BookingRow } from './bookings.ts';

/**
 * الغرفة المباشرة تنشأ من حجز رسمي فقط، لمعلّم معتمد وطالب مصادَق،
 * برمز محدود المدة. الفيديو عبر مزوّد خلف واجهة — الخادم يُصدر الرموز ولا يكشف مفاتيحه.
 */
export interface RoomProvider {
  id: 'internal' | 'livekit' | 'daily' | 'agora';
  createRoom(booking: BookingRow): Promise<{ providerRoomId: string }>;
  issueToken(providerRoomId: string, user: { id: number; name: string; isHost: boolean }, ttlSeconds: number): Promise<{ token: string; joinUrl: string | null }>;
}

/** المزوّد الداخلي: دردشة وحضور ويد عبر Socket.IO — بلا فيديو (placeholder موثّق للمرحلة ١) */
const internal: RoomProvider = {
  id: 'internal',
  async createRoom(booking) { return { providerRoomId: `room_${booking.id}_${randomToken(6)}` }; },
  async issueToken(providerRoomId, user, ttl) {
    const token = jwt.sign({ sub: String(user.id), room: providerRoomId, host: user.isHost, name: user.name }, config.jwt.secret, { expiresIn: ttl });
    return { token, joinUrl: null };
  },
};

/** LiveKit: توقيع JWT بمفتاح الخادم — يُفعَّل بضبط LIVEKIT_* */
const livekit: RoomProvider = {
  id: 'livekit',
  async createRoom(booking) { return { providerRoomId: `booking-${booking.id}` }; },
  async issueToken(providerRoomId, user, ttl) {
    const { apiKey, apiSecret, url } = config.rooms.livekit;
    if (!apiKey || !apiSecret) throw new AppError('server_error', 'مزوّد الفيديو غير مهيّأ', 500);
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({
      iss: apiKey, sub: String(user.id), name: user.name, nbf: now, exp: now + ttl,
      video: { room: providerRoomId, roomJoin: true, roomAdmin: user.isHost, canPublish: true, canSubscribe: true, canPublishData: true },
    }, apiSecret, { algorithm: 'HS256' });
    return { token, joinUrl: url };
  },
};

const providers: Record<string, RoomProvider> = { internal, livekit };
export const roomProvider = (): RoomProvider => providers[config.rooms.provider] ?? internal;

export function ensureRoom(booking: BookingRow) {
  const existing = q.get<any>('SELECT * FROM live_rooms WHERE booking_id = ?', booking.id);
  if (existing) return existing;
  const openBefore = settings.get<number>('room_open_minutes_before');
  const closeAfter = settings.get<number>('room_close_minutes_after');
  const opensAt = addMinutes(-openBefore, new Date(booking.starts_at));
  const closesAt = addMinutes(closeAfter, new Date(booking.ends_at));
  const providerRoomId = `pending`;
  q.run('INSERT INTO live_rooms (booking_id, provider, provider_room_id, opens_at, closes_at) VALUES (?,?,?,?,?)',
    booking.id, roomProvider().id, providerRoomId, opensAt, closesAt);
  return q.get<any>('SELECT * FROM live_rooms WHERE booking_id = ?', booking.id);
}

/** يتحقّق من كل الشروط ويُصدر رمز دخول — أو يرفض بسبب واضح */
export async function issueRoomAccess(bookingId: number, user: { id: number; roles: string[]; name: string }) {
  const booking = q.get<BookingRow>('SELECT * FROM bookings WHERE id = ?', bookingId);
  if (!booking) throw notFound('الحجز غير موجود');
  const isTeacher = booking.teacher_id === user.id;
  const isStudent = booking.student_id === user.id;
  const isAdmin = user.roles.includes('admin') || user.roles.includes('super_admin') || user.roles.includes('support');
  if (!isTeacher && !isStudent && !isAdmin) throw forbidden();
  if (!['confirmed', 'in_progress'].includes(booking.status)) throw new AppError('content_unavailable', 'الحصة غير مؤكّدة', 403);
  if (isTeacher) {
    const status = q.val<string>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', user.id);
    if (status !== 'verified') throw forbidden('حساب المعلّم غير معتمد');
  }

  const room = ensureRoom(booking);
  const now = Date.now();
  if (now < new Date(room.opens_at).getTime()) throw new AppError('content_unavailable', 'لم تُفتح القاعة بعد', 403);
  if (now > new Date(room.closes_at).getTime() || room.status === 'ended') throw new AppError('content_unavailable', 'انتهت الحصة', 403);

  const provider = roomProvider();
  let providerRoomId: string = room.provider_room_id;
  if (providerRoomId === 'pending') {
    ({ providerRoomId } = await provider.createRoom(booking));
    q.run("UPDATE live_rooms SET provider_room_id = ?, status = 'open' WHERE id = ?", providerRoomId, room.id);
  }

  const ttl = Math.min(config.rooms.tokenTtlSeconds, Math.max(60, Math.floor((new Date(room.closes_at).getTime() - now) / 1000)));
  const { token, joinUrl } = await provider.issueToken(providerRoomId, { id: user.id, name: user.name, isHost: isTeacher || isAdmin }, ttl);
  db.transaction(() => {
    q.run('INSERT INTO room_participants (room_id, user_id, token_hash, token_expires_at) VALUES (?,?,?,?)', room.id, user.id, sha256(token), Math.floor(now / 1000) + ttl);
  })();

  return { provider: provider.id, roomId: providerRoomId, token, expiresAt: new Date(now + ttl * 1000).toISOString(), joinUrl, isHost: isTeacher || isAdmin, booking, roomRowId: room.id as number, iceServers: config.rooms.iceServers };
}

/** يتحقّق من رمز غرفة داخلية عند اتصال Socket.IO */
export function verifyInternalRoomToken(token: string): { userId: number; room: string; isHost: boolean; name: string } | null {
  try {
    const p = jwt.verify(token, config.jwt.secret) as { sub: string; room: string; host: boolean; name: string };
    if (!p.room) return null;
    const row = q.get<any>('SELECT rp.id, rp.token_expires_at, lr.status FROM room_participants rp JOIN live_rooms lr ON lr.id = rp.room_id WHERE rp.token_hash = ?', sha256(token));
    if (!row || row.status === 'ended' || row.token_expires_at < Math.floor(Date.now() / 1000)) return null;
    return { userId: Number(p.sub), room: p.room, isHost: !!p.host, name: p.name };
  } catch { return null; }
}

export function endRoom(bookingId: number) {
  q.run("UPDATE live_rooms SET status = 'ended' WHERE booking_id = ?", bookingId);
}

export const roomOpensAt = (booking: BookingRow): string =>
  addMinutes(-settings.get<number>('room_open_minutes_before'), new Date(booking.starts_at));
export const roomIsOpen = (booking: BookingRow): boolean => {
  const now = Date.now();
  return ['confirmed', 'in_progress'].includes(booking.status)
    && now >= new Date(roomOpensAt(booking)).getTime()
    && now <= new Date(addMinutes(settings.get<number>('room_close_minutes_after'), new Date(booking.ends_at))).getTime();
};
export { nowIso };
