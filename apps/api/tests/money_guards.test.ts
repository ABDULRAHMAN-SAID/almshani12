/** حراسات المال والبيانات: سقف الاسترجاع، أساس استرجاع الحصة، حلّ النزاع مرة واحدة، سقوف الكوبون، أرباح الباقة، وحذف المنهج */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

const bookAt = (token: string, teacherId: number, startsAt: string, extra: Record<string, unknown> = {}) =>
  c.api('/api/bookings', { method: 'POST', token, body: { teacherId, subjectId: c.cat.subjects.physics, mode: 'individual', durationMinutes: 60, startsAt, ...extra } });
const coupon = (adminToken: string, body: Record<string, unknown>) =>
  c.api('/api/admin/coupons', { method: 'POST', token: adminToken, body: { startsAt: null, endsAt: null, usageLimit: null, userLimit: null, scope: {}, active: true, ...body } });

test('الاسترجاع لا يتجاوز المدفوع ناقص ما استُرجع', async () => {
  const t = await c.teacher('97000001');
  const s = await c.student('97000002');
  const fin = await c.staff('97000003', 'finance');
  const w = await import('../src/services/wallet.ts');
  w.credit(s.id, 100, {});
  const bookId = c.book(t.id, { price: 5 });
  const buy = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', items: [{ itemType: 'book', itemId: bookId }] } });
  assert.equal(buy.json.paid, true);
  const orderId = buy.json.order.id as number;
  const paidBalance = w.balance(s.id);

  const refund = (amount?: number) => c.api(`/api/admin/orders/${orderId}/refund`, { method: 'POST', token: fin.token, body: { amount, reason: 'اختبار السقف' } });
  assert.equal((await refund(2)).status, 200);
  assert.equal((await refund(2)).status, 200);
  assert.equal(w.balance(s.id), paidBalance + 4);
  // المتبقّي ١ فقط: أي مبلغ أكبر يُرفض ولا يُقيَّد شيء
  const over = await refund(2);
  assert.equal(over.status, 409);
  assert.ok(over.json.error.message.includes('يتجاوز'), over.json.error.message);
  assert.equal(w.balance(s.id), paidBalance + 4);
  assert.equal((await refund(0.5)).status, 200);
  assert.equal((await refund(0.5)).json.status, 'refunded');
  assert.equal(w.balance(s.id), paidBalance + 5, 'مجموع الاسترجاع = إجمالي الطلب بالضبط');
  // الطلب استُرجع بالكامل: لا استرجاع بعده
  assert.equal((await refund(1)).status, 409);
  assert.equal((await refund()).status, 409);
  assert.equal(c.q.val('SELECT COALESCE(SUM(amount),0) FROM refunds WHERE order_id = ?', orderId), 5);
});

test('استرجاع الحصة من المبلغ المدفوع (بعد الكوبون) لا من سعر المعلّم', async () => {
  const t = await c.teacher('97000011');
  const s = await c.student('97000012');
  const admin = await c.staff('97000013', 'admin');
  const w = await import('../src/services/wallet.ts');
  w.credit(s.id, 100, {});
  assert.equal((await coupon(admin.token, { code: 'HALFX', type: 'percentage', value: 50 })).status, 201);
  const r = await bookAt(s.token, t.id, c.slotIn(48), { couponCode: 'HALFX' });
  assert.equal(r.status, 201);
  assert.equal(c.q.val('SELECT price FROM bookings WHERE id = ?', r.json.booking.id), 6);
  const orderId = c.q.val<number>('SELECT order_id FROM bookings WHERE id = ?', r.json.booking.id)!;
  assert.equal(c.q.val('SELECT total FROM orders WHERE id = ?', orderId), 3);
  const before = w.balance(s.id);
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: r.json.booking.id } });
  assert.equal(w.balance(s.id), before - 3);
  const cancel = await c.api(`/api/bookings/${r.json.booking.id}/cancel`, { method: 'POST', token: s.token, body: {} });
  assert.equal(cancel.json.refundPercent, 100);
  assert.equal(w.balance(s.id), before, 'يُسترجع ٣ (ما دُفع) لا ٦ (سعر المعلّم)');
  assert.equal(c.q.val('SELECT amount FROM refunds WHERE booking_id = ?', r.json.booking.id), 3);
  assert.equal(c.q.val('SELECT status FROM orders WHERE id = ?', orderId), 'refunded');
});

test('حلّ النزاع: للحجوزات المتنازع عليها فقط ومرة واحدة', async () => {
  const t = await c.teacher('97000021');
  const s = await c.student('97000022');
  const support = await c.staff('97000023', 'support');
  const w = await import('../src/services/wallet.ts');
  w.credit(s.id, 50, {});
  const r = await bookAt(s.token, t.id, c.slotIn(40));
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: r.json.booking.id } });
  const id = r.json.booking.id as number;
  const resolve = () => c.api(`/api/admin/bookings/${id}/resolve`, { method: 'POST', token: support.token, body: { resolution: 'refund_student', reason: 'اختبار' } });
  const early = await resolve();
  assert.equal(early.status, 409); assert.ok(early.json.error.message.includes('ليس في نزاع'));

  c.q.run("UPDATE bookings SET status = 'disputed' WHERE id = ?", id);
  const before = w.balance(s.id);
  assert.equal((await resolve()).status, 200);
  assert.equal(w.balance(s.id), before + 6);
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', id), 'completed');
  // تكرار القرار لا يستنزف الطلب مرة أخرى
  const again = await resolve();
  assert.equal(again.status, 409);
  assert.equal(w.balance(s.id), before + 6);
  assert.equal(c.q.val('SELECT COUNT(*) FROM refunds WHERE booking_id = ?', id), 1);
});

test('سقوف الكوبون لا تُتجاوز بطلبات معلّقة متوازية', async () => {
  const t = await c.teacher('97000031');
  const s = await c.student('97000032');
  const admin = await c.staff('97000033', 'admin');
  assert.equal((await coupon(admin.token, { code: 'ONCE', type: 'fixed', value: 1, userLimit: 1 })).status, 201);
  const b1 = c.book(t.id, { price: 4 });
  const b2 = c.book(t.id, { price: 4 });
  const first = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock', items: [{ itemType: 'book', itemId: b1 }], couponCode: 'ONCE' } });
  assert.equal(first.status, 200); assert.equal(first.json.order.status, 'pending');
  const second = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock', items: [{ itemType: 'book', itemId: b2 }], couponCode: 'ONCE' } });
  assert.equal(second.status, 400);
  assert.ok(second.json.error.message.includes('استخدمت هذا الرمز'), second.json.error.message);
  // بانتهاء الطلب الأول يتحرّر الحجز
  c.q.run("UPDATE orders SET status = 'expired' WHERE id = ?", first.json.order.id);
  assert.equal((await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock', items: [{ itemType: 'book', itemId: b2 }], couponCode: 'ONCE' } })).status, 200);
});

test('تحقّق الكوبون: نسبة ١..٩٠، مبلغ موجب، وفئة معروفة', async () => {
  const admin = await c.staff('97000041', 'admin');
  assert.equal((await coupon(admin.token, { code: 'PCT500', type: 'percentage', value: 500 })).status, 422);
  assert.equal((await coupon(admin.token, { code: 'NEG5', type: 'fixed', value: -5 })).status, 422);
  assert.equal((await coupon(admin.token, { code: 'ZERO', type: 'percentage', value: 0 })).status, 422);
  assert.equal((await coupon(admin.token, { code: 'BADCAT', type: 'fixed', value: 5, scope: { category: 'whatever' } })).status, 422);
  assert.equal((await coupon(admin.token, { code: 'BADLIMIT', type: 'fixed', value: 5, usageLimit: 0 })).status, 422);
  assert.equal((await coupon(admin.token, { code: 'BADDATE', type: 'fixed', value: 5, startsAt: '2026-05-01T00:00:00.000Z', endsAt: '2026-04-01T00:00:00.000Z' })).status, 422);
  assert.equal((await coupon(admin.token, { code: 'GOOD50', type: 'percentage', value: 50, scope: { category: 'book' } })).status, 201);
});

test('أرباح الباقة تتحرّر مع تسليم كل حصة لا بمرور ٢٤ ساعة', async () => {
  const t = await c.teacher('97000051');
  const s = await c.student('97000052');
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 100, {});
  const svc = await import('../src/services/bookings.ts');
  const earnings = await import('../src/services/earnings.ts');
  const pkgId = Number(c.q.run("INSERT INTO lesson_packages (teacher_id, lessons_count, duration_minutes, mode, price) VALUES (?,5,60,'individual',27)", t.id).lastInsertRowid);
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', items: [{ itemType: 'package', itemId: pkgId }] } });
  const earning = c.q.get<any>("SELECT * FROM teacher_earnings WHERE source_type = 'package' AND source_id = ?", pkgId);
  assert.equal(earning.net, 21.6); assert.equal(earning.available_at, null, 'لا تحرير بالوقت للباقات');
  earnings.releaseEarnings(); // المهمة الدورية لا تلمس الباقة
  assert.equal(c.q.val('SELECT available_balance FROM teacher_profiles WHERE user_id = ?', t.id), 0);

  const pp = c.q.val<number>('SELECT id FROM package_purchases WHERE package_id = ?', pkgId)!;
  const deliver = async (hours: number) => {
    const r = await bookAt(s.token, t.id, c.slotIn(hours), { packagePurchaseId: pp });
    svc.markJoined(r.json.booking.id, t.id, 'teacher'); svc.markJoined(r.json.booking.id, s.id, 'student');
    svc.completeBooking(r.json.booking.id);
    return r.json.booking.id as number;
  };
  await deliver(30);
  assert.equal(c.q.val('SELECT available_balance FROM teacher_profiles WHERE user_id = ?', t.id), 4.32, 'حصة واحدة = خُمس صافي الباقة');
  for (const h of [31, 32, 33, 34]) await deliver(h);
  assert.equal(c.q.val('SELECT remaining FROM package_purchases WHERE id = ?', pp), 0);
  assert.equal(c.q.val('SELECT available_balance FROM teacher_profiles WHERE user_id = ?', t.id), 21.6, 'بعد تسليم الباقة كلّها يُصرف صافيها كاملاً');
  assert.equal(c.q.val("SELECT net FROM teacher_earnings WHERE source_type = 'package' AND source_id = ?", pkgId), 0);
});

test('حذف عنصر منهج مرتبط يُرفض برسالة تشرح الارتباط', async () => {
  const admin = await c.staff('97000061', 'admin');
  const s = await c.student('97000062', { grade: 12 });
  void s;
  const del = await c.api(`/api/admin/catalog/grades/${c.cat.grades[12]}`, { method: 'DELETE', token: admin.token });
  assert.equal(del.status, 409);
  assert.ok(del.json.error.message.includes('لا يمكن الحذف'), del.json.error.message);
  assert.ok(del.json.error.message.includes('متعلّمين'), del.json.error.message);
  assert.ok(c.q.get('SELECT 1 FROM grades WHERE id = ?', c.cat.grades[12]), 'الصف لم يُحذف');
  assert.equal(c.q.val('SELECT grade_id FROM learners WHERE account_id = ?', s.id), c.cat.grades[12], 'المتعلّم احتفظ بصفّه');
  // عنصر بلا ارتباطات يُحذف
  const fresh = (await c.api('/api/admin/catalog/grades', { method: 'POST', token: admin.token, body: { curriculumId: c.cat.curriculumId, name: 'صف تجريبي', order: 99 } })).json.id;
  assert.equal((await c.api(`/api/admin/catalog/grades/${fresh}`, { method: 'DELETE', token: admin.token })).status, 200);
});

test('PATCH المنهج: تحقّق من الحقول وحقل «active» لا يُطبَّق على جدول لا يملكه', async () => {
  const admin = await c.staff('97000071', 'admin');
  const gradeId = c.cat.grades[12];
  assert.equal((await c.api(`/api/admin/catalog/grades/${gradeId}`, { method: 'PATCH', token: admin.token, body: { name: '' } })).status, 422);
  assert.equal((await c.api(`/api/admin/catalog/grades/${gradeId}`, { method: 'PATCH', token: admin.token, body: { order: -3 } })).status, 422);
  const badActive = await c.api('/api/admin/catalog/countries/1', { method: 'PATCH', token: admin.token, body: { active: true } });
  assert.equal(badActive.status, 400, 'لا 500 من عمود غير موجود');
  // إعادة التسمية تظهر فوراً في البطاقات (ذاكرة المنهج تُفرَّغ مع كل كتابة)
  const t = await c.teacher('97000072');
  const bookId = c.book(t.id, { price: 1 });
  assert.equal((await c.api(`/api/books/${bookId}`)).json.grade.name, c.q.val('SELECT name FROM grades WHERE id = ?', gradeId));
  assert.equal((await c.api(`/api/admin/catalog/grades/${gradeId}`, { method: 'PATCH', token: admin.token, body: { name: 'الصف الثاني عشر' } })).status, 200);
  assert.equal(c.q.val('SELECT name FROM grades WHERE id = ?', gradeId), 'الصف الثاني عشر');
  assert.equal((await c.api(`/api/books/${bookId}`)).json.grade.name, 'الصف الثاني عشر');
});

test('الطوابع الزمنية تخرج ISO بلاحقة Z، والتذكير يطابق معرّف الحجز بالضبط', async () => {
  const t = await c.teacher('97000081');
  const s = await c.student('97000082');
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 50, {});
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  const me = await c.api('/api/auth/me', { token: s.token });
  assert.match(me.json.createdAt, ISO);
  const r = await bookAt(s.token, t.id, c.slotIn(40));
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: r.json.booking.id } });
  const purchases = await c.api('/api/me/purchases', { token: s.token });
  assert.match(purchases.json.orders[0].createdAt, ISO);
  assert.match((await c.api('/api/me/wallet', { token: s.token })).json.transactions[0].createdAt, ISO);
  assert.match(c.q.val<string>('SELECT created_at FROM orders WHERE id = ?', purchases.json.orders[0].id)!, ISO);

  // إشعار لحجز رقمه يبدأ بالرقم نفسه لا يمنع تذكير حجز آخر
  const reminders = await import('../src/services/reminders.ts');
  const notifications = await import('../src/services/notifications.ts');
  const id = r.json.booking.id as number;
  notifications.notify(s.id, { type: 'lesson_in_1h', title: 'قديم', body: null, data: { bookingId: Number(`${id}0`) } });
  c.q.run('UPDATE bookings SET starts_at = ?, ends_at = ? WHERE id = ?', new Date(Date.now() + 30 * 60_000).toISOString(), new Date(Date.now() + 90 * 60_000).toISOString(), id);
  reminders.sendLessonReminders();
  assert.ok(c.q.get("SELECT 1 FROM notifications WHERE user_id = ? AND type = 'lesson_in_1h' AND json_extract(data, '$.bookingId') = ?", s.id, id), 'وصل التذكير رغم وجود إشعار لحجز يبدأ بالرقم نفسه');
});

test('فشل بوابة الدفع: الطلب يصير «فاشلاً» ويمكن إلغاؤه أو إعادة المحاولة', async () => {
  const t = await c.teacher('97000091');
  const s = await c.student('97000092');
  const r = await bookAt(s.token, t.id, c.slotIn(45));
  const orderId = c.q.val<number>('SELECT order_id FROM bookings WHERE id = ?', r.json.booking.id)!;
  const number = c.q.val<string>('SELECT number FROM orders WHERE id = ?', orderId)!;
  // محاكاة فشل البوابة كما يتركه المسار: الطلب «فاشل»
  c.q.run("UPDATE orders SET status = 'failed' WHERE id = ?", orderId);
  const retry = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock', bookingId: r.json.booking.id } });
  assert.equal(retry.status, 200); assert.ok(retry.json.checkoutUrl.includes('/pay/mock/'));
  const view = await c.api(`/api/orders/${number}`, { token: s.token });
  assert.equal(view.json.status, 'pending');
  assert.equal(view.json.checkoutUrl, retry.json.checkoutUrl, 'رابط البوابة محفوظ ويظهر في صفحة الطلب');
  assert.ok(view.json.expiresAt);
  const cancel = await c.api(`/api/orders/${number}/cancel`, { method: 'POST', token: s.token });
  assert.equal(cancel.status, 200); assert.equal(cancel.json.status, 'cancelled');
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', r.json.booking.id), 'expired', 'الموعد تحرّر');
  assert.equal((await c.api(`/api/orders/${number}/cancel`, { method: 'POST', token: s.token })).status, 409);
  // صفحة الدفع التجريبية لا تعكس ?ref في الصفحة
  const page = await c.api(`/pay/mock/${number}?ref=%3C/script%3E%3Cimg%20src=x%20onerror=alert(1)%3E`);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('onerror=alert(1)'), 'لا انعكاس لمُدخل المستخدم في الصفحة');
});

test('رفع الملفات يمرّ عبر القرص ويحترم حدّ الغرض', async () => {
  const s = await c.student('97000101');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: 'image/png' }), 'a.png');
  const res = await fetch(`${c.base}/api/files?purpose=avatar`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` }, body: form });
  assert.equal(res.status, 201);
  const j = await res.json() as any;
  assert.equal(j.size, 7); assert.ok(j.url);
  const row = c.q.get<any>('SELECT * FROM files WHERE id = ?', j.id);
  assert.equal(row.purpose, 'avatar'); assert.equal(row.visibility, 'public');
  assert.ok(!row.storage_path.includes('tmp'), 'نُقل من المجلّد المؤقّت إلى المخزن');
  // تجاوز حدّ الغرض (٨ ميغابايت للصورة) يُرفض بلا حفظ
  const big = new FormData();
  big.append('file', new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/png' }), 'big.png');
  const rejected = await fetch(`${c.base}/api/files?purpose=avatar`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` }, body: big });
  assert.ok(rejected.status >= 400, `توقّعنا رفضاً، جاء ${rejected.status}`);
  assert.equal(c.q.val('SELECT COUNT(*) FROM files WHERE owner_id = ?', s.id), 1);
});

test('مستندات هوية المعلّم للدعم لا للمالية، والتوفّر للمعلّم المعتمد وحده', async () => {
  const pending = await c.teacher('97000111', { status: 'pending' });
  const support = await c.staff('97000112', 'support');
  const fin = await c.staff('97000113', 'finance');
  const storage = await import('../src/services/storage.ts');
  const seed = await import('../src/db/seed.ts');
  const f = storage.storeFile(seed.makePdf('هوية', 1), { ownerId: pending.id, originalName: 'id.pdf', mime: 'application/pdf', purpose: 'document' });
  c.q.run("INSERT INTO teacher_documents (teacher_id, type, file_id) VALUES (?,'id',?)", pending.id, f.id);
  const forSupport = await c.api(`/api/admin/teachers/${pending.id}`, { token: support.token });
  assert.equal(forSupport.json.documents.length, 1);
  const forFinance = await c.api(`/api/admin/teachers/${pending.id}`, { token: fin.token });
  assert.equal(forFinance.status, 200);
  assert.deepEqual(forFinance.json.documents, [], 'المالية لا ترى مستندات الهوية');

  const rules = [{ weekday: 1, startTime: '10:00', endTime: '12:00', slotMinutes: 60, breakMinutes: 0 }];
  assert.equal((await c.api('/api/teacher/availability', { method: 'PUT', token: pending.token, body: rules })).status, 403);
  const verified = await c.teacher('97000114');
  assert.equal((await c.api('/api/teacher/availability', { method: 'PUT', token: verified.token, body: rules })).status, 200);
  // فترتان متداخلتان في اليوم نفسه تُرفضان (كانتا تُضاعفان المواعيد المعروضة)
  const overlap = await c.api('/api/teacher/availability', { method: 'PUT', token: verified.token, body: [...rules, { weekday: 1, startTime: '11:00', endTime: '13:00', slotMinutes: 60, breakMinutes: 0 }] });
  assert.equal(overlap.status, 400);
  assert.ok(overlap.json.error.message.includes('متداخلة'));
  assert.equal(c.q.val('SELECT COUNT(*) FROM teacher_availability WHERE teacher_id = ?', verified.id), 1, 'الفترات لم تُستبدل بالطلب المرفوض');
});
