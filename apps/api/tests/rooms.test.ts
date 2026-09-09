import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

const confirmed = (studentId: number, teacherId: number, startsInMin: number) => {
  const starts = new Date(Date.now() + startsInMin * 60_000).toISOString();
  const ends = new Date(Date.now() + (startsInMin + 60) * 60_000).toISOString();
  return Number(c.q.run(`INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price) VALUES (?,?,?,'individual',60,?,?,'confirmed',6)`,
    studentId, teacherId, c.cat.subjects.physics, starts, ends).lastInsertRowid);
};

test('رمز الغرفة: من حجز مؤكّد داخل النافذة فقط، للطرفين فقط، محدود المدة', async () => {
  const t = await c.teacher('96000001');
  const s = await c.student('96000002');
  const stranger = await c.student('96000003');
  const early = confirmed(s.id, t.id, 120);
  const r0 = await c.api(`/api/bookings/${early}/room`, { token: s.token });
  assert.equal(r0.status, 403); assert.equal(r0.json.error.code, 'content_unavailable');

  const soon = confirmed(s.id, t.id, 5);
  assert.equal((await c.api(`/api/bookings/${soon}/room`, { token: stranger.token })).status, 403);
  assert.equal((await c.api(`/api/bookings/${soon}/room`)).status, 401);
  const rs = await c.api(`/api/bookings/${soon}/room`, { token: s.token });
  assert.equal(rs.status, 200);
  assert.equal(rs.json.provider, 'internal'); assert.equal(rs.json.isHost, false); assert.equal(rs.json.realtimeNamespace, '/room');
  assert.ok(rs.json.token.length > 20);
  const rt = await c.api(`/api/bookings/${soon}/room`, { token: t.token });
  assert.equal(rt.json.isHost, true);
  assert.equal(rt.json.roomId, rs.json.roomId, 'الغرفة نفسها للطرفين');
  const rooms = await import('../src/services/rooms.ts');
  const v = rooms.verifyInternalRoomToken(rs.json.token);
  assert.ok(v && v.userId === s.id && !v.isHost);
  assert.equal(rooms.verifyInternalRoomToken(rs.json.token + 'x'), null);
  assert.ok(new Date(rs.json.expiresAt).getTime() - Date.now() <= 3 * 3600 * 1000 + 1000);
  // بعد إنهاء الغرفة الرمز لا يعمل
  rooms.endRoom(soon);
  assert.equal(rooms.verifyInternalRoomToken(rs.json.token), null);
  assert.equal((await c.api(`/api/bookings/${soon}/room`, { token: s.token })).status, 403);
});

test('الحجز غير المؤكّد والحصة المنتهية والمعلّم غير المعتمد لا يدخلون', async () => {
  const t = await c.teacher('96000011');
  const s = await c.student('96000012');
  const pending = Number(c.q.run(`INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price) VALUES (?,?,?,'individual',60,?,?,'pending_payment',6)`,
    s.id, t.id, c.cat.subjects.physics, new Date(Date.now() + 5 * 60_000).toISOString(), new Date(Date.now() + 65 * 60_000).toISOString()).lastInsertRowid);
  assert.equal((await c.api(`/api/bookings/${pending}/room`, { token: s.token })).status, 403);
  const over = confirmed(s.id, t.id, -120);
  assert.equal((await c.api(`/api/bookings/${over}/room`, { token: s.token })).status, 403);
  const live = confirmed(s.id, t.id, 2);
  c.q.run("UPDATE teacher_profiles SET verification_status = 'suspended' WHERE user_id = ?", t.id);
  assert.equal((await c.api(`/api/bookings/${live}/room`, { token: t.token })).status, 403);
});

test('Socket.IO /room: الدخول بالرمز يسجّل الحضور، الدردشة تُحفظ، والانقطاع يسجّل الخروج', async () => {
  const { io } = await import('socket.io-client');
  const t = await c.teacher('96000021');
  const s = await c.student('96000022');
  const bookingId = confirmed(s.id, t.id, 3);
  const rs = await c.api(`/api/bookings/${bookingId}/room`, { token: s.token });
  const bad = io(`${c.base}/room`, { auth: { roomToken: 'nope' }, transports: ['websocket'], reconnection: false });
  await new Promise<void>(r => bad.on('connect_error', e => { assert.equal(e.message, 'room_token_invalid'); r(); }));
  const sock = io(`${c.base}/room`, { auth: { roomToken: rs.json.token }, transports: ['websocket'], reconnection: false });
  const welcome: any = await new Promise(r => sock.on('room:welcome', r));
  assert.equal(welcome.you.role, 'student');
  assert.equal(welcome.participants.length, 1);
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', bookingId), 'in_progress');
  assert.ok(c.q.get("SELECT 1 FROM booking_attendance WHERE booking_id = ? AND role = 'student' AND left_at IS NULL", bookingId));
  const ack: any = await new Promise(r => sock.emit('chat:send', { body: 'مرحباً' }, r));
  assert.equal(ack.ok, true);
  assert.equal(c.q.val('SELECT COUNT(*) FROM room_messages'), 1);
  sock.disconnect();
  await new Promise(r => setTimeout(r, 150));
  assert.ok(c.q.get("SELECT 1 FROM booking_attendance WHERE booking_id = ? AND role = 'student' AND left_at IS NOT NULL", bookingId));
  // إعادة الاتصال بالرمز نفسه تعمل وتُحتسب reconnect
  const again = io(`${c.base}/room`, { auth: { roomToken: rs.json.token }, transports: ['websocket'], reconnection: false });
  await new Promise(r => again.on('room:welcome', r));
  assert.equal(c.q.val('SELECT SUM(reconnects) FROM booking_attendance WHERE booking_id = ?', bookingId), 1);
  again.disconnect();
  bad.close();
});

test('حساب الإدارة يدخل مراقباً: لا صفة مضيف ولا حضور يُسجَّل له', async () => {
  const { io } = await import('socket.io-client');
  const t = await c.teacher('96000031');
  const s = await c.student('96000032');
  const adm = await c.staff('96000033', 'admin');
  const bookingId = confirmed(s.id, t.id, 3);
  const ra = await c.api(`/api/bookings/${bookingId}/room`, { token: adm.token });
  assert.equal(ra.status, 200);
  assert.equal(ra.json.isHost, false, 'الإدارة تراقب ولا تستضيف');
  const sock = io(`${c.base}/room`, { auth: { roomToken: ra.json.token }, transports: ['websocket'], reconnection: false });
  const welcome: any = await new Promise(r => sock.on('room:welcome', r));
  assert.equal(welcome.you.role, 'observer');
  assert.equal(welcome.you.isHost, false);
  assert.equal(c.q.val('SELECT COUNT(*) FROM booking_attendance WHERE booking_id = ?', bookingId), 0, 'المراقب لا يُكتب له حضور');
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', bookingId), 'confirmed', 'ولا يقلب الحجز إلى in_progress');
  sock.disconnect();
  await new Promise(r => setTimeout(r, 150));
});

test('share:state تمرّ من أي مشارك ومعها معرّف صاحبها', async () => {
  const { io } = await import('socket.io-client');
  const t = await c.teacher('96000041');
  const s = await c.student('96000042');
  const bookingId = confirmed(s.id, t.id, 3);
  const rt = await c.api(`/api/bookings/${bookingId}/room`, { token: t.token });
  const rs = await c.api(`/api/bookings/${bookingId}/room`, { token: s.token });
  const teacherSock = io(`${c.base}/room`, { auth: { roomToken: rt.json.token }, transports: ['websocket'], reconnection: false });
  await new Promise(r => teacherSock.on('room:welcome', r));
  const studentSock = io(`${c.base}/room`, { auth: { roomToken: rs.json.token }, transports: ['websocket'], reconnection: false });
  await new Promise(r => studentSock.on('room:welcome', r));
  const seen: any = await new Promise(r => { teacherSock.on('share:state', r); studentSock.emit('share:state', { sharing: true }); });
  assert.equal(seen.sharing, true, 'مشاركة الطالب تصل المعلّم — لم تعد حكراً على المضيف');
  assert.equal(seen.userId, s.id, 'ومعها صاحبها كي يميّزها المتلقّي');
  teacherSock.disconnect(); studentSock.disconnect();
  await new Promise(r => setTimeout(r, 150));
});

test('مقبس واحد لكل مستخدم في الغرفة: الأحدث يكسب والأقدم يُبلَّغ ويُفصل', async () => {
  const { io } = await import('socket.io-client');
  const t = await c.teacher('96000051');
  const s = await c.student('96000052');
  const bookingId = confirmed(s.id, t.id, 3);
  const rs = await c.api(`/api/bookings/${bookingId}/room`, { token: s.token });
  const first = io(`${c.base}/room`, { auth: { roomToken: rs.json.token }, transports: ['websocket'], reconnection: false });
  await new Promise(r => first.on('room:welcome', r));
  const takenOver = new Promise(r => first.on('room:takenOver', r));
  const second = io(`${c.base}/room`, { auth: { roomToken: rs.json.token }, transports: ['websocket'], reconnection: false });
  const welcome: any = await new Promise(r => second.on('room:welcome', r));
  assert.ok(await takenOver, 'التبويب الأقدم يعرف لماذا خرج');
  assert.equal(welcome.participants.filter((p: any) => p.userId === s.id).length, 1);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(first.connected, false);
  assert.ok(c.q.get("SELECT 1 FROM booking_attendance WHERE booking_id = ? AND user_id = ? AND left_at IS NULL", bookingId, s.id), 'والحضور يبقى مفتوحاً لأن المستخدم ما زال في الغرفة');
  assert.equal(c.q.val('SELECT COUNT(*) FROM booking_attendance WHERE booking_id = ? AND user_id = ?', bookingId, s.id), 1, 'ولا يُحتسب انتقال التبويب انقطاعاً وعودة');
  second.disconnect();
  await new Promise(r => setTimeout(r, 150));
});
