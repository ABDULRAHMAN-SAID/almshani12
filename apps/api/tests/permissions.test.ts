import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

test('الصلاحيات تُفرض في الخادم لكل دور', async () => {
  const s = await c.student('95000001');
  const support = await c.staff('95000002', 'support');
  const reviewer = await c.staff('95000003', 'content_reviewer');
  const finance = await c.staff('95000004', 'finance');
  const admin = await c.staff('95000005', 'admin');
  const superAdmin = await c.staff('95000006', 'super_admin');
  const hit = (path: string, token: string, method = 'GET', body?: unknown) => c.api(path, { method, token, body }).then(r => r.status);

  assert.equal(await hit('/api/admin/overview', s.token), 403);
  assert.equal(await hit('/api/admin/overview', support.token), 200);
  assert.equal(await hit('/api/admin/settings', support.token), 200);
  assert.equal(await hit('/api/admin/settings', support.token, 'PUT', { commission_rate: 0.1 }), 403, 'الدعم لا يغيّر السياسات');
  assert.equal(await hit('/api/admin/settings', admin.token, 'PUT', { commission_rate: 0.1 }), 200);
  assert.equal(await hit('/api/admin/content', s.token), 403);
  assert.equal(await hit('/api/admin/content', reviewer.token), 200);
  assert.equal(await hit('/api/admin/payouts', reviewer.token), 403);
  assert.equal(await hit('/api/admin/payouts', finance.token), 200);
  assert.equal(await hit(`/api/admin/users/${s.id}/roles`, admin.token, 'POST', { roles: ['student', 'admin'] }), 403, 'الأدوار للـ super_admin فقط');
  assert.equal(await hit(`/api/admin/users/${s.id}/roles`, superAdmin.token, 'POST', { roles: ['student', 'support'] }), 200);
  assert.equal(await hit('/api/admin/audit', admin.token), 200);
});

test('المعلّم غير المعتمد لا ينشر ولا يُحجز؛ الاعتماد يمرّ عبر قرار إداري مسجَّل', async () => {
  const pending = await c.teacher('95000011', { status: 'pending' });
  const admin = await c.staff('95000012', 'admin');
  const bookBody = { title: 'ملخّص جديد', type: 'summary', subjectId: c.cat.subjects.physics, gradeId: c.cat.grades[12], semesterId: null, description: 'وصف', price: 2, pages: 10, edition: null, version: null, level: null };
  assert.equal((await c.api('/api/books', { method: 'POST', token: pending.token, body: bookBody })).status, 403);
  assert.equal((await c.api('/api/teachers')).json.data.some((t: any) => t.id === pending.id), false, 'لا يظهر في البحث');
  assert.equal((await c.api(`/api/teachers/${pending.id}`)).status, 404);
  const decision = await c.api(`/api/admin/teachers/${pending.id}/decision`, { method: 'POST', token: admin.token, body: { decision: 'verified', commissionRate: 0.15 } });
  assert.equal(decision.status, 200);
  const created = await c.api('/api/books', { method: 'POST', token: pending.token, body: bookBody });
  assert.equal(created.status, 201); assert.equal(created.json.status, 'draft');
  assert.equal((await c.api(`/api/teachers/${pending.id}`)).status, 200);
  assert.ok(c.q.get("SELECT 1 FROM audit_logs WHERE action = 'teacher.verified' AND entity_id = ?", pending.id));
  assert.equal(c.q.val('SELECT commission_rate FROM teacher_profiles WHERE user_id = ?', pending.id), 0.15);
  // الكتاب لا يُنشَر إلا بعد مراجعة
  assert.equal((await c.api(`/api/books/${created.json.id}/submit`, { method: 'POST', token: pending.token })).status, 400, 'بلا ملف');
  assert.equal((await c.api('/api/books')).json.data.some((b: any) => b.id === created.json.id), false);
});

test('المعلّم الموقوف تُلغى حصصه ويُعاد المال', async () => {
  const t = await c.teacher('95000021');
  const s = await c.student('95000022');
  const admin = await c.staff('95000023', 'admin');
  const w = await import('../src/services/wallet.ts'); w.credit(s.id, 10, {});
  const r = await c.api('/api/bookings', { method: 'POST', token: s.token, body: { teacherId: t.id, subjectId: c.cat.subjects.physics, mode: 'individual', durationMinutes: 60, startsAt: c.slotIn(30) } });
  await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: r.json.booking.id } });
  assert.equal(w.balance(s.id), 4);
  await c.api(`/api/admin/teachers/${t.id}/decision`, { method: 'POST', token: admin.token, body: { decision: 'suspended', reason: 'بلاغات' } });
  assert.equal(c.q.val('SELECT status FROM bookings WHERE id = ?', r.json.booking.id), 'cancelled_by_teacher');
  assert.equal(w.balance(s.id), 10);
  assert.equal((await c.api('/api/books', { method: 'POST', token: t.token, body: {} })).status, 403);
});

test('الخصوصية: هاتف الطالب وبريده لا يظهران للمعلّم ولا في بطاقات المستخدمين', async () => {
  const t = await c.teacher('95000031');
  const s = await c.student('95000032');
  c.q.run(`INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price) VALUES (?,?,?,'individual',60,?,?,'completed',6)`,
    s.id, t.id, c.cat.subjects.physics, c.slotIn(-30), c.slotIn(-29));
  const students = await c.api('/api/teacher/students', { token: t.token });
  assert.equal(students.status, 200);
  const dump = JSON.stringify(students.json);
  assert.ok(!dump.includes('95000032') && !dump.includes('phone') && !dump.includes('email'));
  const lessons = await c.api('/api/bookings?as=teacher', { token: t.token });
  assert.ok(!JSON.stringify(lessons.json).includes('95000032'));
  const profile = await c.api(`/api/teachers/${t.id}`);
  assert.ok(!JSON.stringify(profile.json).includes('95000031'), 'هاتف المعلّم نفسه لا يظهر علناً');
});

test('الطالب لا يرى حجز غيره ولا يلغيه', async () => {
  const t = await c.teacher('95000041');
  const a = await c.student('95000042');
  const b = await c.student('95000043');
  const r = await c.api('/api/bookings', { method: 'POST', token: a.token, body: { teacherId: t.id, subjectId: c.cat.subjects.physics, mode: 'individual', durationMinutes: 60, startsAt: c.slotIn(30) } });
  assert.equal((await c.api(`/api/bookings/${r.json.booking.id}`, { token: b.token })).status, 403);
  assert.equal((await c.api(`/api/bookings/${r.json.booking.id}/cancel`, { method: 'POST', token: b.token, body: {} })).status, 403);
  assert.equal((await c.api(`/api/bookings/${r.json.booking.id}/notes`, { method: 'POST', token: a.token, body: { summary: 'x', homework: null } })).status, 403, 'الملاحظات للمعلّم فقط');
});

test('المراسلة: المعلّم لا يبدأ محادثة مع طالب لم يحجز معه؛ الحظر يقطع الرسائل', async () => {
  const t = await c.teacher('95000051');
  const s = await c.student('95000052');
  const cold = await c.api('/api/conversations', { method: 'POST', token: t.token, body: { userId: s.id } });
  assert.equal(cold.status, 403);
  const conv = await c.api('/api/conversations', { method: 'POST', token: s.token, body: { userId: t.id } });
  assert.equal(conv.status, 201);
  assert.equal((await c.api(`/api/conversations/${conv.json.id}/messages`, { method: 'POST', token: t.token, body: { body: 'أهلاً' } })).status, 201);
  await c.api(`/api/blocks/${t.id}`, { method: 'POST', token: s.token });
  assert.equal((await c.api(`/api/conversations/${conv.json.id}/messages`, { method: 'POST', token: t.token, body: { body: 'مرحباً' } })).status, 403);
});
