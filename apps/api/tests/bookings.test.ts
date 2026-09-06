import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

const bookAt = (token: string, teacherId: number, startsAt: string, extra: Record<string, unknown> = {}) =>
  c.api('/api/bookings', { method: 'POST', token, body: { teacherId, subjectId: c.cat.subjects.physics, mode: 'individual', durationMinutes: 60, startsAt, ...extra } });

test('التوفّر: يولّد المواعيد ويستثني الإجازات والحجوزات وما مضى', async () => {
  const t = await c.teacher('94000001', { allDay: false });
  c.q.run("INSERT INTO teacher_availability (teacher_id, weekday, start_time, end_time, slot_minutes, break_minutes) VALUES (?,?, '10:00','13:00',60,0)", t.id, new Date(Date.now() + 2 * 86_400_000 + 4 * 3_600_000).getUTCDay());
  const day = new Date(Date.now() + 2 * 86_400_000 + 4 * 3_600_000).toISOString().slice(0, 10);
  const r = await c.api(`/api/teachers/${t.id}/availability?from=${day}&days=1&durationMinutes=60`);
  assert.equal(r.status, 200);
  assert.equal(r.json[0].slots.length, 3);
  assert.equal(r.json[0].slots[0].startsAt, c.helpers.muscatToUtc(day, '10:00'));
  // إجازة تغطّي الموعد الثاني
  c.q.run('INSERT INTO teacher_time_off (teacher_id, starts_at, ends_at) VALUES (?,?,?)', t.id, c.helpers.muscatToUtc(day, '11:00'), c.helpers.muscatToUtc(day, '12:00'));
  const r2 = await c.api(`/api/teachers/${t.id}/availability?from=${day}&days=1&durationMinutes=60`);
  assert.deepEqual(r2.json[0].slots.map((s: any) => s.available), [true, false, true]);
  // مدة ٣٠ دقيقة تنتج مواعيد بخطوة الخانة نفسها
  const r3 = await c.api(`/api/teachers/${t.id}/availability?from=${day}&days=1&durationMinutes=30`);
  assert.equal(r3.json[0].slots.length, 3);
});

test('الحجز: معلّق الدفع مع طلب ومهلة، ومنع التعارض على الموعد نفسه', async () => {
  const t = await c.teacher('94000011');
  const s1 = await c.student('94000012');
  const s2 = await c.student('94000013');
  const slot = c.slotIn(48);
  const r = await bookAt(s1.token, t.id, slot);
  assert.equal(r.status, 201);
  assert.equal(r.json.booking.status, 'pending_payment');
  assert.equal(r.json.paymentRequired, true);
  assert.ok(r.json.orderNumber && r.json.expiresAt);
  const conflict = await bookAt(s2.token, t.id, slot);
  assert.equal(conflict.status, 409); assert.equal(conflict.json.error.code, 'booking_conflict');
  // تداخل جزئي (٣٠ دقيقة داخل الساعة) يُرفض أيضاً
  const overlap = await c.api('/api/bookings', { method: 'POST', token: s2.token, body: { teacherId: t.id, subjectId: c.cat.subjects.physics, mode: 'individual', durationMinutes: 30, startsAt: new Date(new Date(slot).getTime() + 30 * 60_000).toISOString() } });
  assert.equal(overlap.status, 409);
  // في الماضي / خارج التوفّر / معلّم غير معتمد / مادة لا يدرّسها
  assert.equal((await bookAt(s2.token, t.id, c.slotIn(-2))).status, 400);
  const pending = await c.teacher('94000014', { status: 'pending' });
  const np = await bookAt(s2.token, pending.id, c.slotIn(30));
  assert.equal(np.status, 400); assert.equal(np.json.error.code, 'teacher_unavailable');
  const wrongSubject = await c.api('/api/bookings', { method: 'POST', token: s2.token, body: { teacherId: t.id, subjectId: c.cat.subjects.arabic, mode: 'individual', durationMinutes: 60, startsAt: c.slotIn(30) } });
  assert.equal(wrongSubject.status, 400);
  const limited = await c.teacher('94000015', { allDay: false });
  const outside = await bookAt(s2.token, limited.id, c.slotIn(30));
  assert.equal(outside.status, 400); assert.equal(outside.json.error.code, 'teacher_unavailable');
});

test('انتهاء مهلة الدفع يحرّر الموعد', async () => {
  const t = await c.teacher('94000021');
  const s = await c.student('94000022');
  const slot = c.slotIn(50);
  const r = await bookAt(s.token, t.id, slot);
  c.q.run('UPDATE bookings SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), r.json.booking.id);
  const svc = await import('../src/services/bookings.ts');
  assert.equal(svc.expirePendingBookings(), 1);
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', r.json.booking.id), 'expired');
  const again = await bookAt(s.token, t.id, slot);
  assert.equal(again.status, 201, 'الموعد أصبح متاحاً من جديد');
  // الدفع على الحجز المنتهي يُرفض
  const pay = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: r.json.booking.id } });
  assert.equal(pay.status, 409);
});

test('الدفع يؤكّد الحجز؛ سياسة الإلغاء تُقرأ من الإعدادات لا من الشيفرة', async () => {
  const t = await c.teacher('94000031');
  const s = await c.student('94000032');
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 100, {});
  // ١) قبل ٤٨ ساعة → ١٠٠٪
  const far = await bookAt(s.token, t.id, c.slotIn(48));
  const pay = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: far.json.booking.id } });
  assert.equal(pay.json.paid, true);
  const view = await c.api(`/api/bookings/${far.json.booking.id}`, { token: s.token });
  assert.equal(view.json.status, 'confirmed'); assert.equal(view.json.cancelRefundPercent, 100);
  assert.ok(c.q.get("SELECT 1 FROM teacher_earnings WHERE source_type = 'lesson' AND source_id = ? AND status = 'pending'", far.json.booking.id));
  const before = w.balance(s.id);
  const cancel = await c.api(`/api/bookings/${far.json.booking.id}/cancel`, { method: 'POST', token: s.token, body: { reason: 'ظرف' } });
  assert.equal(cancel.json.refundPercent, 100);
  assert.equal(w.balance(s.id), before + 6);
  assert.equal(c.q.val("SELECT status FROM teacher_earnings WHERE source_type = 'lesson' AND source_id = ?", far.json.booking.id), 'reversed');
  assert.equal(c.q.val('SELECT status FROM orders WHERE id = ?', c.q.val('SELECT order_id FROM bookings WHERE id = ?', far.json.booking.id)), 'refunded');

  // ٢) قبل ١٣ ساعة → ٥٠٪ بالسياسة الافتراضية
  const mid = await bookAt(s.token, t.id, c.slotIn(13));
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: mid.json.booking.id } });
  const b2 = w.balance(s.id);
  const c2 = await c.api(`/api/bookings/${mid.json.booking.id}/cancel`, { method: 'POST', token: s.token, body: {} });
  assert.equal(c2.json.refundPercent, 50);
  assert.equal(w.balance(s.id), b2 + 3);

  // ٣) تغيير السياسة من الإعدادات: قبل ٦ ساعات → ٧٠٪
  c.settings.set('cancellation_policy', [{ hoursBefore: 6, refundPercent: 70 }, { hoursBefore: 0, refundPercent: 0 }]);
  const near = await bookAt(s.token, t.id, c.slotIn(7));
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: near.json.booking.id } });
  assert.equal((await c.api(`/api/bookings/${near.json.booking.id}`, { token: s.token })).json.cancelRefundPercent, 70);
  const b3 = w.balance(s.id);
  const c3 = await c.api(`/api/bookings/${near.json.booking.id}/cancel`, { method: 'POST', token: s.token, body: {} });
  assert.equal(c3.json.refundPercent, 70);
  assert.equal(w.balance(s.id), Number((b3 + 4.2).toFixed(3)));
  const refund = c.q.get<any>('SELECT * FROM refunds WHERE booking_id = ?', near.json.booking.id);
  assert.ok(refund.policy_applied.includes('"refundPercent":70'), 'تُحفظ نسخة من السياسة وقت الاسترجاع');

  // ٤) إلغاء المعلّم → ١٠٠٪ دائماً حتى قبل ساعة
  const soon = await bookAt(s.token, t.id, c.slotIn(2));
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: soon.json.booking.id } });
  const b4 = w.balance(s.id);
  const ct = await c.api(`/api/bookings/${soon.json.booking.id}/cancel`, { method: 'POST', token: t.token, body: { reason: 'طارئ' } });
  assert.equal(ct.json.refundPercent, 100);
  assert.equal(w.balance(s.id), b4 + 6);
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', soon.json.booking.id), 'cancelled_by_teacher');
  c.settings.set('cancellation_policy', [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 12, refundPercent: 50 }, { hoursBefore: 0, refundPercent: 0 }]);
});

test('الباقة: تُشترى مرة وتُستهلك حصة حصة، والإلغاء المبكّر يعيد الحصة', async () => {
  const t = await c.teacher('94000041');
  const s = await c.student('94000042');
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 100, {});
  const pkgId = Number(c.q.run("INSERT INTO lesson_packages (teacher_id, lessons_count, duration_minutes, mode, price) VALUES (?,5,60,'individual',27)", t.id).lastInsertRowid);
  const buy = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', items: [{ itemType: 'package', itemId: pkgId }] } });
  assert.equal(buy.json.paid, true);
  const feed = await c.api('/api/bookings', { token: s.token });
  assert.equal(feed.json.packages.length, 1); assert.equal(feed.json.packages[0].remaining, 5);
  const pp = feed.json.packages[0].id;
  const r = await bookAt(s.token, t.id, c.slotIn(40), { packagePurchaseId: pp });
  assert.equal(r.status, 201); assert.equal(r.json.booking.status, 'confirmed'); assert.equal(r.json.paymentRequired, false);
  assert.equal(c.q.val('SELECT remaining FROM package_purchases WHERE id = ?', pp), 4);
  await c.api(`/api/bookings/${r.json.booking.id}/cancel`, { method: 'POST', token: s.token, body: {} });
  assert.equal(c.q.val('SELECT remaining FROM package_purchases WHERE id = ?', pp), 5);
  const foreign = await c.student('94000043');
  const steal = await bookAt(foreign.token, t.id, c.slotIn(41), { packagePurchaseId: pp });
  assert.equal(steal.status, 400, 'باقة شخص آخر لا تُستخدم');
});

test('الحضور: no_show للمعلّم يعيد المبلغ كاملاً، واكتمال الحصة يحرّر الربح', async () => {
  const t = await c.teacher('94000051');
  const s = await c.student('94000052');
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 50, {});
  const svc = await import('../src/services/bookings.ts');
  const mk = async () => { const r = await bookAt(s.token, t.id, c.slotIn(30)); await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: r.json.booking.id } }); return r.json.booking.id as number; };
  const b1 = await mk();
  const before = w.balance(s.id);
  svc.completeBooking(b1); // لا حضور للمعلّم
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', b1), 'no_show');
  assert.equal(w.balance(s.id), before + 6);
  const b2 = await mk();
  svc.markJoined(b2, t.id, 'teacher'); svc.markJoined(b2, s.id, 'student');
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', b2), 'in_progress');
  svc.markLeft(b2, s.id); svc.markJoined(b2, s.id, 'student'); // إعادة اتصال
  assert.equal(c.q.val('SELECT SUM(reconnects) FROM booking_attendance WHERE booking_id = ? AND user_id = ?', b2, s.id), 1);
  svc.completeBooking(b2);
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', b2), 'completed');
  assert.equal(c.q.val("SELECT status FROM teacher_earnings WHERE source_type = 'lesson' AND source_id = ?", b2), 'available');
  assert.equal(c.q.val('SELECT available_balance FROM teacher_profiles WHERE user_id = ?', t.id), 4.8);
  const view = await c.api(`/api/bookings/${b2}`, { token: s.token });
  assert.equal(view.json.needsReview, true);
  assert.ok(view.json.attendance.teacherJoinedAt);
});

test('إعادة الجدولة تحفظ الحجز نفسه على موعد جديد', async () => {
  const t = await c.teacher('94000061');
  const s = await c.student('94000062');
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 10, {});
  const r = await bookAt(s.token, t.id, c.slotIn(60));
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: r.json.booking.id } });
  const to = c.slotIn(70);
  const rs = await c.api(`/api/bookings/${r.json.booking.id}/reschedule`, { method: 'POST', token: s.token, body: { startsAt: to } });
  assert.equal(rs.status, 200); assert.equal(rs.json.startsAt, to); assert.equal(rs.json.status, 'confirmed');
});
