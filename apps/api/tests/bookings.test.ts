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

const flat = (feed: any) => [...feed.upcoming.today, ...feed.upcoming.tomorrow, ...feed.upcoming.thisWeek, ...feed.upcoming.later, ...feed.past];
const REF_KEYS = ['id', 'displayName', 'gradeName', 'avatarUrl'];

test('المتعلّمون: وليّ الأمر يحجز لابنه (learnerId ثم الترويسة ثم النشط)؛ متعلّم غريب → 403؛ بلا متعلّم → 422', async () => {
  const t = await c.teacher('94000071');
  const p = await c.parent('94000072', [{ name: 'سارة', grade: 12, subjects: ['physics'] }, { name: 'محمد', grade: 11, subjects: ['physics'] }]);
  const [sara, mohammed] = p.learnerIds;
  const w = await import('../src/services/wallet.ts'); w.credit(p.id, 100, {});
  // ١) صريح: الحصة لمحمد والحساب الدافع وليّ الأمر
  const r1 = await bookAt(p.token, t.id, c.slotIn(24), { learnerId: mohammed });
  assert.equal(r1.status, 201);
  assert.equal(r1.json.booking.learner.id, mohammed); assert.equal(r1.json.booking.learner.displayName, 'محمد');
  assert.equal(r1.json.booking.learner.gradeName, c.q.val('SELECT name FROM grades WHERE id = ?', c.cat.grades[11]));
  assert.equal(r1.json.booking.student.id, p.id);
  assert.deepEqual(Object.keys(r1.json.booking.learner), REF_KEYS, 'bookingView.learner = LearnerRef فقط');
  assert.equal(c.q.val('SELECT learner_id FROM bookings WHERE id = ?', r1.json.booking.id), mohammed);
  assert.equal(c.q.val('SELECT learner_id FROM orders WHERE id = ?', r1.json.orderId), mohammed, 'طلب الحصة منسوب للمتعلّم نفسه');
  // ٢) الترويسة وحدها تحدّد المتعلّم
  const r2 = await c.api('/api/bookings', { method: 'POST', token: p.token, headers: { 'X-Learner-Id': String(mohammed) }, body: { teacherId: t.id, subjectId: c.cat.subjects.physics, mode: 'individual', durationMinutes: 60, startsAt: c.slotIn(25) } });
  assert.equal(r2.status, 201); assert.equal(r2.json.booking.learner.id, mohammed);
  // ٣) بلا شيء → المتعلّم النشط (سارة)
  const r3 = await bookAt(p.token, t.id, c.slotIn(26));
  assert.equal(r3.status, 201); assert.equal(r3.json.booking.learner.id, sara);
  // ٤) متعلّم حساب آخر (صريحاً أو بالترويسة) → 403 learner_forbidden ولا حجز
  const other = await c.student('94000073');
  const bad = await bookAt(p.token, t.id, c.slotIn(27), { learnerId: other.learnerId });
  assert.equal(bad.status, 403); assert.equal(bad.json.error.code, 'learner_forbidden');
  const badHeader = await c.api('/api/bookings', { method: 'POST', token: p.token, headers: { 'X-Learner-Id': String(other.learnerId) }, body: { teacherId: t.id, subjectId: c.cat.subjects.physics, mode: 'individual', durationMinutes: 60, startsAt: c.slotIn(27) } });
  assert.equal(badHeader.status, 403); assert.equal(badHeader.json.error.code, 'learner_forbidden');
  assert.equal(c.q.val('SELECT COUNT(*) FROM bookings WHERE student_id = ?', p.id), 3);
  // ٥) حساب بلا متعلّم → 422 learner_required
  const none = await c.login('94000074');
  const nl = await bookAt(none.token, t.id, c.slotIn(28));
  assert.equal(nl.status, 422); assert.equal(nl.json.error.code, 'learner_required');
  // الدفع يبقي المتعلّم كما هو
  const pay = await c.api('/api/checkout', { method: 'POST', token: p.token, body: { provider: 'wallet', bookingId: r1.json.booking.id } });
  assert.equal(pay.json.paid, true); assert.equal(pay.json.order.learner.id, mohammed);
  assert.equal((await c.api(`/api/bookings/${r1.json.booking.id}`, { token: p.token })).json.learner.id, mohammed);
});

test('GET /bookings?learnerId= يرشّح حصص متعلّم واحد ويعيد learners وpackages[].learnerId؛ متعلّم غريب → 403', async () => {
  const t = await c.teacher('94000081');
  const p = await c.parent('94000082', [{ name: 'سارة', grade: 12, subjects: ['physics'] }, { name: 'محمد', grade: 11, subjects: ['physics'] }]);
  const [sara, mohammed] = p.learnerIds;
  const w = await import('../src/services/wallet.ts'); w.credit(p.id, 100, {});
  const b1 = await bookAt(p.token, t.id, c.slotIn(24), { learnerId: mohammed });
  const b2 = await bookAt(p.token, t.id, c.slotIn(25), { learnerId: mohammed });
  const b3 = await bookAt(p.token, t.id, c.slotIn(26), { learnerId: sara });
  for (const b of [b1, b2, b3]) assert.equal((await c.api('/api/checkout', { method: 'POST', token: p.token, body: { provider: 'wallet', bookingId: b.json.booking.id } })).json.paid, true);
  const all = await c.api('/api/bookings', { token: p.token });
  assert.equal(all.status, 200);
  assert.deepEqual(flat(all.json).map((b: any) => b.id).sort(), [b1, b2, b3].map(b => b.json.booking.id).sort(), 'بلا ترشيح: كل المتعلّمين');
  assert.deepEqual(all.json.learners.map((l: any) => l.id), [sara, mohammed]);
  for (const l of all.json.learners) assert.deepEqual(Object.keys(l), REF_KEYS);
  const onlyM = await c.api(`/api/bookings?learnerId=${mohammed}`, { token: p.token });
  assert.equal(onlyM.status, 200);
  assert.deepEqual(flat(onlyM.json).map((b: any) => b.id).sort(), [b1, b2].map(b => b.json.booking.id).sort());
  assert.ok(flat(onlyM.json).every((b: any) => b.learner.id === mohammed));
  const onlyS = await c.api(`/api/bookings?learnerId=${sara}`, { token: p.token });
  assert.deepEqual(flat(onlyS.json).map((b: any) => b.id), [b3.json.booking.id]);
  // الترويسة لا ترشّح تبويب الحصص (كل المتعلّمين) — الترشيح بالمعلمة فقط
  const viaHeader = await c.api('/api/bookings', { token: p.token, headers: { 'X-Learner-Id': String(sara) } });
  assert.equal(flat(viaHeader.json).length, 3);
  const other = await c.student('94000083');
  const foreign = await c.api(`/api/bookings?learnerId=${other.learnerId}`, { token: p.token });
  assert.equal(foreign.status, 403); assert.equal(foreign.json.error.code, 'learner_forbidden');
  assert.equal((await c.api('/api/bookings?learnerId=abc', { token: p.token })).status, 422);
  // المعلّم: as=teacher يرى حصصه كلّها مع learner في كل حجز، وقائمة learners فارغة
  const asT = await c.api('/api/bookings?as=teacher', { token: t.token });
  assert.equal(flat(asT.json).length, 3); assert.deepEqual(asT.json.learners, []); assert.deepEqual(asT.json.packages, []);
  assert.ok(flat(asT.json).every((b: any) => b.learner && Object.keys(b.learner).length === 4));
});

test('GET /teacher/students: صفوف {learner, lessons, lastAt} فقط والمتعلّم LearnerRef فقط — لا هاتف ولا بريد ولا معرّف حساب', async () => {
  const t = await c.teacher('94000091');
  const p = await c.parent('94000092', [{ name: 'سارة', grade: 12, subjects: ['physics'] }, { name: 'محمد', grade: 11, subjects: ['physics'] }]);
  const [sara, mohammed] = p.learnerIds;
  const s = await c.student('94000093');
  const w = await import('../src/services/wallet.ts'); w.credit(p.id, 100, {}); w.credit(s.id, 100, {});
  const pay = async (r: any, token: string) => assert.equal((await c.api('/api/checkout', { method: 'POST', token, body: { provider: 'wallet', bookingId: r.json.booking.id } })).json.paid, true);
  await pay(await bookAt(p.token, t.id, c.slotIn(24), { learnerId: mohammed }), p.token);
  await pay(await bookAt(p.token, t.id, c.slotIn(25), { learnerId: mohammed }), p.token);
  await pay(await bookAt(p.token, t.id, c.slotIn(26), { learnerId: sara }), p.token);
  await pay(await bookAt(s.token, t.id, c.slotIn(27)), s.token);
  await bookAt(p.token, t.id, c.slotIn(28), { learnerId: sara }); // معلّق الدفع لا يُحسب
  // حجز قديم بلا متعلّم → مرجع اصطناعي بمعرّف سالب من الحساب
  const legacy = await c.student('94000094');
  c.q.run(`INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price, learner_id) VALUES (?,?,?,'individual',60,?,?,'completed',6,NULL)`, legacy.id, t.id, c.cat.subjects.physics, c.slotIn(-48), c.slotIn(-47));
  const st = await c.api('/api/teacher/students', { token: t.token });
  assert.equal(st.status, 200); assert.equal(st.json.length, 4);
  for (const row of st.json) {
    assert.deepEqual(Object.keys(row), ['learner', 'lessons', 'lastAt']);
    assert.deepEqual(Object.keys(row.learner), REF_KEYS);
  }
  const byId = Object.fromEntries(st.json.map((r: any) => [r.learner.id, r]));
  assert.equal(byId[mohammed].lessons, 2); assert.equal(byId[sara].lessons, 1); assert.equal(byId[s.learnerId].lessons, 1);
  assert.equal(byId[mohammed].learner.displayName, 'محمد'); assert.equal(byId[mohammed].learner.gradeName, c.q.val('SELECT name FROM grades WHERE id = ?', c.cat.grades[11]));
  assert.equal(byId[-legacy.id].lessons, 1); assert.equal(byId[-legacy.id].learner.gradeName, null); assert.equal(byId[-legacy.id].learner.displayName, 'طالب 094');
  assert.deepEqual(st.json.map((r: any) => r.learner.id), [s.learnerId, sara, mohammed, -legacy.id], 'الأحدث حصةً أولاً');
  const text = JSON.stringify(st.json);
  for (const phone of ['94000092', '94000093', '94000094']) assert.ok(!text.includes(phone), 'لا هاتف');
  assert.ok(!text.includes('"phone"') && !text.includes('"email"') && !text.includes('account'), 'لا بيانات حساب');
  // طالب عادي لا يصل
  assert.equal((await c.api('/api/teacher/students', { token: s.token })).status, 403);
});

test('الباقة لمتعلّم بعينه لا تُستخدم لغيره؛ الباقة العامة (بلا متعلّم) لأي متعلّم؛ إشعار المعلّم يسمّي المتعلّم', async () => {
  const t = await c.teacher('94000101');
  const p = await c.parent('94000102', [{ name: 'سارة', grade: 12, subjects: ['physics'] }, { name: 'محمد', grade: 11, subjects: ['physics'] }]);
  const [sara, mohammed] = p.learnerIds;
  const w = await import('../src/services/wallet.ts'); w.credit(p.id, 100, {});
  const pkgId = Number(c.q.run("INSERT INTO lesson_packages (teacher_id, lessons_count, duration_minutes, mode, price) VALUES (?,5,60,'individual',27)", t.id).lastInsertRowid);
  const buy = await c.api('/api/checkout', { method: 'POST', token: p.token, body: { provider: 'wallet', items: [{ itemType: 'package', itemId: pkgId }], learnerId: sara } });
  assert.equal(buy.status, 200); assert.equal(buy.json.paid, true); assert.equal(buy.json.order.learner.id, sara);
  assert.equal(c.q.val('SELECT learner_id FROM orders WHERE id = ?', buy.json.order.id), sara);
  const pp = c.q.get<any>('SELECT id, learner_id FROM package_purchases WHERE order_id = ?', buy.json.order.id);
  assert.equal(pp.learner_id, sara, 'الباقة تتبع متعلّم الطلب');
  const feed = await c.api('/api/bookings', { token: p.token });
  assert.equal(feed.json.packages.length, 1); assert.equal(feed.json.packages[0].id, pp.id); assert.equal(feed.json.packages[0].learnerId, sara);
  // لمحمد → مرفوضة؛ لسارة → مؤكّدة فوراً
  const wrong = await bookAt(p.token, t.id, c.slotIn(30), { packagePurchaseId: pp.id, learnerId: mohammed });
  assert.equal(wrong.status, 400);
  assert.equal(c.q.val('SELECT remaining FROM package_purchases WHERE id = ?', pp.id), 5);
  const ok = await bookAt(p.token, t.id, c.slotIn(30), { packagePurchaseId: pp.id, learnerId: sara });
  assert.equal(ok.status, 201); assert.equal(ok.json.booking.status, 'confirmed'); assert.equal(ok.json.booking.learner.id, sara);
  assert.equal(c.q.val('SELECT remaining FROM package_purchases WHERE id = ?', pp.id), 4);
  const note = c.q.get<any>("SELECT title, body FROM notifications WHERE user_id = ? AND type = 'booking_confirmed' ORDER BY id DESC LIMIT 1", t.id);
  assert.equal(note.title, 'حجز جديد');
  assert.ok(note.body.includes('سارة') && note.body.includes(c.q.val('SELECT name FROM grades WHERE id = ?', c.cat.grades[12])!) && note.body.includes('فيزياء'), note.body);
  assert.ok(!note.body.includes('94000102'), 'لا هاتف في إشعار المعلّم');
  // باقة عامة (learner_id NULL) تصلح لمحمد
  c.q.run('UPDATE package_purchases SET learner_id = NULL WHERE id = ?', pp.id);
  const any = await bookAt(p.token, t.id, c.slotIn(31), { packagePurchaseId: pp.id, learnerId: mohammed });
  assert.equal(any.status, 201); assert.equal(any.json.booking.learner.id, mohammed);
  assert.equal((await c.api('/api/bookings', { token: p.token })).json.packages[0].learnerId, null);
  // إلغاء الطالب المبكّر يعيد الحصة والحجز يحتفظ بمتعلّمه
  await c.api(`/api/bookings/${any.json.booking.id}/cancel`, { method: 'POST', token: p.token, body: {} });
  assert.equal(c.q.val('SELECT remaining FROM package_purchases WHERE id = ?', pp.id), 4);
  assert.equal(c.q.val('SELECT learner_id FROM bookings WHERE id = ?', any.json.booking.id), mohammed);
});

test('الملف العام للمعلّم: stats وavailabilityRules وtimeOff؛ students_count = متعلّمون متمايزون عند الاكتمال', async () => {
  const t = await c.teacher('94000111', { allDay: false });
  const wd = new Date(Date.now() + 2 * 86_400_000 + 4 * 3_600_000).getUTCDay();
  c.q.run("INSERT INTO teacher_availability (teacher_id, weekday, start_time, end_time, slot_minutes, break_minutes) VALUES (?,?, '10:00','13:00',60,0)", t.id, wd);
  c.q.run('INSERT INTO teacher_time_off (teacher_id, starts_at, ends_at, reason) VALUES (?,?,?,?)', t.id, c.slotIn(48), c.slotIn(52), 'سبب خاص');
  c.q.run('INSERT INTO teacher_time_off (teacher_id, starts_at, ends_at) VALUES (?,?,?)', t.id, c.slotIn(24 * 40), c.slotIn(24 * 41)); // بعد ٣٠ يوماً: لا تظهر
  const prof = await c.api(`/api/teachers/${t.id}`);
  assert.equal(prof.status, 200);
  assert.deepEqual(prof.json.stats, { studentsCount: 0, lessonsCount: 0, ratingCount: 0, yearsExp: 5 });
  assert.deepEqual(prof.json.availabilityRules, [{ weekday: wd, startTime: '10:00', endTime: '13:00' }]);
  assert.deepEqual(prof.json.timeOff, [{ from: c.slotIn(48), to: c.slotIn(52) }]);
  assert.ok(!JSON.stringify(prof.json.timeOff).includes('سبب'), 'بلا أسباب');
  // حصتان مكتملتان لمتعلّمَين من حساب واحد → طالبان
  const p = await c.parent('94000112', [{ name: 'سارة', grade: 12, subjects: ['physics'] }, { name: 'محمد', grade: 11, subjects: ['physics'] }]);
  const svc = await import('../src/services/bookings.ts');
  for (const lid of p.learnerIds) {
    const id = Number(c.q.run(`INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price, learner_id) VALUES (?,?,?,'individual',60,?,?,'confirmed',6,?)`,
      p.id, t.id, c.cat.subjects.physics, c.slotIn(-3), c.slotIn(-2), lid).lastInsertRowid);
    svc.markJoined(id, t.id, 'teacher'); svc.markJoined(id, p.id, 'student');
    svc.completeBooking(id);
  }
  assert.equal(c.q.val('SELECT students_count FROM teacher_profiles WHERE user_id = ?', t.id), 2);
  assert.equal(c.q.val('SELECT lessons_count FROM teacher_profiles WHERE user_id = ?', t.id), 2);
  const after = await c.api(`/api/teachers/${t.id}`);
  assert.equal(after.json.stats.studentsCount, 2); assert.equal(after.json.stats.lessonsCount, 2); assert.equal(after.json.studentsCount, 2);
});

test('ملاحظات الحصة: إعادة الحفظ تدمج المرفقات ولا تمحوها', async () => {
  const t = await c.teacher('94000091');
  const s = await c.student('94000092');
  const id = Number(c.q.run(`INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price) VALUES (?,?,?,'individual',60,?,?,'completed',6)`,
    s.id, t.id, c.cat.subjects.physics, c.slotIn(-30), c.slotIn(-29)).lastInsertRowid);
  const file = (name: string) => Number(c.q.run("INSERT INTO files (owner_id, storage_path, original_name, mime, size, visibility, purpose) VALUES (?,?,?,?,?,'private','attachment')",
    t.id, `attachment/${name}`, name, 'application/pdf', 10).lastInsertRowid);
  const a = file('sheet-1.pdf'), b = file('sheet-2.pdf'), d = file('sheet-3.pdf');
  const notes = (body: unknown) => c.api(`/api/bookings/${id}/notes`, { method: 'POST', token: t.token, body });
  const attachments = async () => (await c.api(`/api/bookings/${id}`, { token: s.token })).json.notes.attachments.map((x: any) => x.fileId);
  assert.equal((await notes({ summary: 'ملخّص', homework: 'واجب', attachmentFileIds: [a, b] })).status, 200);
  assert.deepEqual(await attachments(), [a, b]);
  // شاشة الملاحظات ترسل قائمة فارغة عند تصحيح النصّ: المرفقات تبقى
  assert.equal((await notes({ summary: 'ملخّص مصحّح', homework: 'واجب' })).status, 200);
  assert.deepEqual(await attachments(), [a, b]);
  assert.equal((await c.api(`/api/bookings/${id}`, { token: s.token })).json.notes.summary, 'ملخّص مصحّح');
  assert.equal((await c.api(`/api/bookings/${id}/notes/files/${a}`, { token: s.token })).status, 200, 'الطالب ما زال يفتح المرفق');
  // مرفق جديد يُضاف بلا تكرار القديم
  assert.equal((await notes({ summary: 'ملخّص', homework: null, attachmentFileIds: [a, d] })).status, 200);
  assert.deepEqual(await attachments(), [a, b, d]);
  // الحذف المتعمّد يُذكر صراحةً — والملف يُمحى فلا يبقى مقروءاً بلا مرجع
  assert.equal((await notes({ summary: 'ملخّص', homework: null, attachmentFileIds: [], removeFileIds: [b] })).status, 200);
  assert.deepEqual(await attachments(), [a, d]);
  assert.equal(c.q.val('SELECT COUNT(*) FROM files WHERE id = ?', b), 0);
  assert.equal((await c.api(`/api/bookings/${id}/notes/files/${b}`, { token: s.token })).status, 404, 'الطالب لم يعد يفتح المحذوف');
  // إعادة إرسال مرفق ما زال مذكوراً في القائمة لا تحذفه مهما ذُكر في removeFileIds
  assert.equal((await notes({ summary: 'ملخّص', homework: null, attachmentFileIds: [a], removeFileIds: [a] })).status, 200);
  assert.deepEqual(await attachments(), [a, d]);
  assert.equal(c.q.val('SELECT COUNT(*) FROM files WHERE id = ?', a), 1);
});
