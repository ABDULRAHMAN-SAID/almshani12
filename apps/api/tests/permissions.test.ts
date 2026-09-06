import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/* ---------- مصفوفة مسارات الإدارة الجديدة × الأدوار (§7.7) ---------- */
type RoleName = 'student' | 'support' | 'content_reviewer' | 'finance' | 'admin' | 'super_admin';
const ROLE_NAMES: RoleName[] = ['student', 'support', 'content_reviewer', 'finance', 'admin', 'super_admin'];
interface Route { name: string; method?: string; path: () => string; body?: unknown; allow: RoleName[]; setup?: () => void }

test('مصفوفة الصلاحيات: كل مسار إداري جديد × كل دور — 403 لغير المصرّح، ونجاح للمصرّح (أجسام صالحة دنيا)', async () => {
  const actors: Record<RoleName, string> = {
    student: (await c.student('95100001')).token, support: (await c.staff('95100002', 'support')).token, content_reviewer: (await c.staff('95100003', 'content_reviewer')).token,
    finance: (await c.staff('95100004', 'finance')).token, admin: (await c.staff('95100005', 'admin')).token, super_admin: (await c.staff('95100006', 'super_admin')).token,
  };
  const tg = await c.student('95100011');            // الهدف العام
  const lt = await c.student('95100012');            // هدف مسارات المتعلّمين (الحدّ ٦)
  const victim = await c.student('95100013');        // هدف الحذف
  const st = await c.staff('95100015', 'super_admin'); // هدف من الطاقم: لا يمسّه إلا super_admin (D8)
  const tt = await c.teacher('95100014');            // معلّم معتمد
  const bookId = c.book(tt.id);
  const fileId = Number(c.q.run("INSERT INTO files (owner_id, storage_path, original_name, mime, size, visibility, purpose) VALUES (?,?,?,?,?,?,?)", tt.id, 'document/p.pdf', 'p.pdf', 'application/pdf', 10, 'private', 'document').lastInsertRowid);
  const docId = Number(c.q.run("INSERT INTO teacher_documents (teacher_id, type, file_id) VALUES (?,'id',?)", tt.id, fileId).lastInsertRowid);
  const rid = Number(c.q.run("INSERT INTO reviews (user_id, target_type, target_id, rating, comment, gate_type, gate_id) VALUES (?,?,?,?,?,'booking',1)", tg.id, 'teacher', tt.id, 4, 'جيد').lastInsertRowid);
  let entId = 0, lid = 0;
  const learnerBody = { displayName: 'ابن', isSelf: false, curriculumId: c.cat.curriculumId, gradeId: c.cat.grades[11], semesterId: c.cat.semesters[1], subjectIds: [c.cat.subjects.math] };
  const U = `/api/admin/users/${tg.id}`, T = `/api/admin/teachers/${tt.id}`;
  const routes: Route[] = [
    { name: 'users list', path: () => '/api/admin/users?role=student&sort=name', allow: ['support', 'admin', 'super_admin'] },
    { name: 'person', path: () => U, allow: ['support', 'finance', 'admin', 'super_admin'] },
    { name: 'profile', method: 'PATCH', path: () => `${U}/profile`, body: { timezone: 'Asia/Muscat' }, allow: ['admin', 'super_admin'] },
    { name: 'status active', method: 'POST', path: () => `${U}/status`, body: { status: 'active' }, allow: ['admin', 'super_admin'] },
    { name: 'role grant parent', method: 'POST', path: () => `${U}/roles/grant`, body: { role: 'parent' }, allow: ['admin', 'super_admin'] },
    { name: 'role grant support', method: 'POST', path: () => `${U}/roles/grant`, body: { role: 'support' }, allow: ['super_admin'] },
    { name: 'role revoke parent', method: 'POST', path: () => `${U}/roles/revoke`, body: { role: 'parent' }, allow: ['admin', 'super_admin'] },
    { name: 'roles replace (old)', method: 'POST', path: () => `${U}/roles`, body: { roles: ['student'] }, allow: ['super_admin'] },
    { name: 'wallet', path: () => `${U}/wallet`, allow: ['support', 'finance', 'admin', 'super_admin'] },
    { name: 'wallet adjust', method: 'POST', path: () => `${U}/wallet/adjust`, body: { amount: 1, note: 'رصيد اختبار' }, allow: ['finance', 'admin', 'super_admin'] },
    { name: 'entitlements', path: () => `${U}/entitlements`, allow: ['support', 'finance', 'admin', 'super_admin'] },
    { name: 'grant', method: 'POST', path: () => `${U}/grant`, body: { itemType: 'book', itemId: bookId }, allow: ['admin', 'super_admin'] },
    { name: 'entitlement revoke', method: 'DELETE', path: () => `${U}/entitlements/${entId}`, body: { reason: 'اختبار الصلاحيات' }, allow: ['admin', 'super_admin'],
      setup: () => { c.q.run("INSERT OR IGNORE INTO entitlements (user_id, item_type, item_id, source) VALUES (?, 'book', ?, 'admin')", tg.id, bookId); entId = c.q.val<number>("SELECT id FROM entitlements WHERE user_id = ? AND item_type = 'book' AND item_id = ?", tg.id, bookId)!; } },
    { name: 'reviews of user', path: () => `${U}/reviews`, allow: ['support', 'admin', 'super_admin'] },
    { name: 'review hide', method: 'POST', path: () => `/api/admin/reviews/${rid}/hide`, body: { reason: 'اختبار الصلاحيات' }, allow: ['support', 'admin', 'super_admin'] },
    { name: 'review unhide', method: 'POST', path: () => `/api/admin/reviews/${rid}/unhide`, allow: ['support', 'admin', 'super_admin'] },
    { name: 'sessions', path: () => `${U}/sessions`, allow: ['support', 'admin', 'super_admin'] },
    { name: 'sessions revoke', method: 'POST', path: () => `${U}/sessions/revoke`, body: {}, allow: ['support', 'admin', 'super_admin'] },
    { name: 'learner add', method: 'POST', path: () => `/api/admin/users/${lt.id}/learners`, body: learnerBody, allow: ['support', 'admin', 'super_admin'] },
    { name: 'learner patch', method: 'PATCH', path: () => `/api/admin/users/${lt.id}/learners/${lt.learnerId}`, body: { school: 'مدرسة' }, allow: ['support', 'admin', 'super_admin'] },
    { name: 'learner activate', method: 'POST', path: () => `/api/admin/users/${lt.id}/learners/${lt.learnerId}/activate`, allow: ['support', 'admin', 'super_admin'] },
    { name: 'learner archive', method: 'DELETE', path: () => `/api/admin/users/${lt.id}/learners/${lid}`, allow: ['support', 'admin', 'super_admin'], setup: () => { lid = c.addLearner(lt.id, 'مؤقّت', { isSelf: false, grade: 11, subjects: ['math'] }); } },
    { name: 'audit by target', path: () => `/api/admin/audit?targetUserId=${tg.id}`, allow: ['admin', 'super_admin'] },
    { name: 'teacher detail', path: () => T, allow: ['support', 'finance', 'admin', 'super_admin'] },
    { name: 'teachers list filters', path: () => `/api/admin/teachers?subjectId=${c.cat.subjects.physics}&minRating=0&sort=rating_desc`, allow: ['support', 'admin', 'super_admin'] },
    { name: 'document decision', method: 'POST', path: () => `${T}/documents/${docId}/decision`, body: { decision: 'accepted' }, allow: ['admin', 'super_admin'] },
    { name: 'teacher patch', method: 'PATCH', path: () => T, body: { headline: 'عنوان', reason: 'تحديث البيانات' }, allow: ['admin', 'super_admin'] },
    { name: 'teacher earnings', path: () => `${T}/earnings`, allow: ['finance', 'admin', 'super_admin'] },
    { name: 'teacher reviews', path: () => `${T}/reviews`, allow: ['support', 'admin', 'super_admin'] },
    { name: 'teacher students', path: () => `${T}/students`, allow: ['support', 'admin', 'super_admin'] },
    { name: 'overview', path: () => '/api/admin/overview?days=7', allow: ['support', 'content_reviewer', 'finance', 'admin', 'super_admin'] },
    { name: 'bookings by student', path: () => `/api/admin/bookings?studentId=${tg.id}`, allow: ['support', 'finance', 'admin', 'super_admin'] },
    { name: 'orders by user', path: () => `/api/admin/orders?userId=${tg.id}`, allow: ['support', 'finance', 'admin', 'super_admin'] },
    { name: 'payouts by teacher', path: () => `/api/admin/payouts?teacherId=${tt.id}&status=all`, allow: ['finance', 'admin', 'super_admin'] },
    { name: 'content by author', path: () => `/api/admin/content?authorId=${tt.id}&status=all`, allow: ['content_reviewer', 'admin', 'super_admin'] },
    { name: 'reports by reporter', path: () => `/api/admin/reports?reporterId=${tg.id}&status=all`, allow: ['support', 'admin', 'super_admin'] },
    { name: 'status deleted', method: 'POST', path: () => `/api/admin/users/${victim.id}/status`, body: { status: 'deleted', reason: 'طلب المستخدم' }, allow: ['super_admin'] },
    // أهداف من الطاقم: تبديل الهاتف/البريد أو الإيقاف أو إنهاء الجلسات لحساب super_admin لا يفعله admin ولا support
    { name: 'profile (staff target)', method: 'PATCH', path: () => `/api/admin/users/${st.id}/profile`, body: { phone: '+96895100099' }, allow: ['super_admin'] },
    { name: 'status suspended (staff target)', method: 'POST', path: () => `/api/admin/users/${st.id}/status`, body: { status: 'suspended', reason: 'اختبار الصلاحيات' }, allow: ['super_admin'] },
    { name: 'status active (staff target)', method: 'POST', path: () => `/api/admin/users/${st.id}/status`, body: { status: 'active' }, allow: ['super_admin'] },
    { name: 'sessions revoke (staff target)', method: 'POST', path: () => `/api/admin/users/${st.id}/sessions/revoke`, body: {}, allow: ['super_admin'] },
  ];
  for (const r of routes) {
    for (const role of ROLE_NAMES) {
      const allowed = r.allow.includes(role);
      if (allowed) r.setup?.();
      const res = await c.api(r.path(), { method: r.method ?? 'GET', token: actors[role], body: r.body });
      if (allowed) assert.ok([200, 201, 204].includes(res.status), `${r.name}: ${role} يجب أن يمرّ — ${res.status} ${res.text}`);
      else assert.equal(res.status, 403, `${r.name}: ${role} يجب أن يُمنع — ${res.status} ${res.text}`);
    }
  }
});

/* ---------- اختبار المصدر: كل مسار كتابة في admin.ts يسجّل audit(…) ---------- */
const here = path.dirname(fileURLToPath(import.meta.url));
test('كل router.post|patch|delete في admin.ts يسجّل audit() (أو يمرّ عبر خدمة المتعلّمين التي تسجّله)', () => {
  const src = fs.readFileSync(path.join(here, '../src/domains/admin.ts'), 'utf8');
  const marks = [...src.matchAll(/router\.(get|post|patch|delete|put|use)\(/g)];
  let checked = 0;
  marks.forEach((m, i) => {
    if (!['post', 'patch', 'delete'].includes(m[1]!)) return;
    const block = src.slice(m.index!, marks[i + 1]?.index ?? src.length);
    // createLearner/updateLearner/archiveLearner تكتب صفّ التدقيق بنفسها مع target_user_id (services/learners.ts)
    assert.ok(/\baudit\(|\b(createLearner|updateLearner|archiveLearner)\(/.test(block), `بلا audit: ${block.split('\n')[0]}`);
    checked++;
  });
  assert.ok(checked >= 35, `عدد مسارات الكتابة المفحوصة: ${checked}`);
});

/* ---------- اختبار المصدر: لا أحد يختار متعلّماً بمعرّفه خارج services/learners.ts ---------- */
test('لا ملف تحت src/ غير services/learners.ts و db/migrations.ts يختار FROM learners … WHERE id', () => {
  const root = path.join(here, '../src');
  const files: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk(root);
  assert.ok(files.length > 20);
  const offenders = files.filter(f => !f.endsWith(path.join('services', 'learners.ts')) && !f.endsWith(path.join('db', 'migrations.ts')))
    .filter(f => /FROM\s+learners(\s+\w+)?\s+WHERE\s+(id|l\.id)\b/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map(f => path.relative(root, f)), []);
});
