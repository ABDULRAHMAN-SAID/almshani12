import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ReviewAdmin, TeacherStudentRow } from '@manassah/shared';
import { boot, type Ctx } from './helpers.ts';

/** صفحة المعلّم (Teacher 360) والنظرة الحيّة */
let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

const post = (token: string, pathname: string, body?: unknown) => c.api(pathname, { method: 'POST', token, body });
const auditRows = (action: string, target: number) => c.q.all<any>('SELECT * FROM audit_logs WHERE action = ? AND target_user_id = ? ORDER BY id', action, target);
/** مستند معلّم بملف مباشر في قاعدة البيانات (التوقيع لا يقرأ الملف) */
function document(teacherId: number, type = 'id') {
  const fileId = Number(c.q.run("INSERT INTO files (owner_id, storage_path, original_name, mime, size, visibility, purpose) VALUES (?,?,?,?,?,?,?)", teacherId, `document/${teacherId}-${type}.pdf`, `${type}.pdf`, 'application/pdf', 10, 'private', 'document').lastInsertRowid);
  return Number(c.q.run('INSERT INTO teacher_documents (teacher_id, type, file_id) VALUES (?,?,?)', teacherId, type, fileId).lastInsertRowid);
}
const booking = (studentId: number, teacherId: number, learnerId: number | null, status: string, hoursFromNow: number) =>
  Number(c.q.run(`INSERT INTO bookings (student_id, teacher_id, learner_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price) VALUES (?,?,?,?,'individual',60,?,?,?,6)`,
    studentId, teacherId, learnerId, c.cat.subjects.physics, c.slotIn(hoursFromNow), c.slotIn(hoursFromNow + 1), status).lastInsertRowid);

test('قرار المستند: يسجّل من راجع ومتى، والرفض يُبلّغ المعلّم', async () => {
  const t = await c.teacher('97000001');
  const other = await c.teacher('97000002');
  const admin = await c.staff('97000003', 'admin');
  const support = await c.staff('97000004', 'support');
  const docId = document(t.id);
  const otherDoc = document(other.id, 'degree');
  const path = `/api/admin/teachers/${t.id}/documents/${docId}/decision`;
  assert.equal((await post(support.token, path, { decision: 'rejected', note: 'غير واضح' })).status, 403);
  assert.equal((await post(admin.token, `/api/admin/teachers/${t.id}/documents/${otherDoc}/decision`, { decision: 'accepted' })).status, 404, 'مستند معلّم آخر');
  const rej = await post(admin.token, path, { decision: 'rejected', note: 'الصورة غير واضحة، أعد الرفع' });
  assert.equal(rej.status, 200);
  assert.equal(rej.json.status, 'rejected'); assert.equal(rej.json.note, 'الصورة غير واضحة، أعد الرفع'); assert.equal(rej.json.reviewedBy.id, admin.id); assert.ok(rej.json.reviewedAt); assert.ok(rej.json.url.includes('/api/files/'));
  const row = c.q.get<any>('SELECT * FROM teacher_documents WHERE id = ?', docId);
  assert.equal(row.reviewed_by, admin.id); assert.ok(row.reviewed_at);
  const note = c.q.get<any>("SELECT * FROM notifications WHERE user_id = ? AND type = 'teacher_document_rejected'", t.id);
  assert.ok(note); assert.equal(note.body, 'الصورة غير واضحة، أعد الرفع');
  const a = auditRows('teacher.document_rejected', t.id); assert.equal(a.length, 1); assert.equal(a[0].entity, 'teacher_documents'); assert.equal(a[0].entity_id, docId);
  const before = c.q.val<number>('SELECT COUNT(*) FROM notifications WHERE user_id = ?', t.id);
  const acc = await post(admin.token, path, { decision: 'accepted' });
  assert.equal(acc.status, 200); assert.equal(acc.json.status, 'accepted');
  assert.equal(c.q.val('SELECT COUNT(*) FROM notifications WHERE user_id = ?', t.id), before, 'القبول لا يُبلّغ');
  assert.equal(auditRows('teacher.document_accepted', t.id).length, 1);
  const detail = await c.api(`/api/admin/teachers/${t.id}`, { token: support.token });
  assert.equal(detail.json.documents.length, 1); assert.equal(detail.json.documents[0].reviewedBy.id, admin.id); assert.equal(detail.json.documents[0].status, 'accepted');
});

test('PATCH /admin/teachers/:id: تغيير العمولة يكتب صفّ تحقّق بسبب، وبقية الحقول لا', async () => {
  const t = await c.teacher('97000011');
  const pending = await c.teacher('97000012', { status: 'pending' });
  const admin = await c.staff('97000013', 'admin');
  const support = await c.staff('97000014', 'support');
  const patch = (id: number, token: string, body: unknown) => c.api(`/api/admin/teachers/${id}`, { method: 'PATCH', token, body });
  assert.equal((await patch(t.id, support.token, { commissionRate: 0.25, reason: 'اتفاق خاص' })).status, 403);
  assert.equal((await patch(t.id, admin.token, { commissionRate: 0.25 })).status, 422, 'السبب مطلوب');
  assert.equal((await patch(t.id, admin.token, { commissionRate: 0.9, reason: 'اتفاق خاص' })).status, 422, 'العمولة ≤ ٠٫٦');
  const before = c.q.val<number>('SELECT COUNT(*) FROM teacher_verifications WHERE teacher_id = ?', t.id)!;
  const r = await patch(t.id, admin.token, { commissionRate: 0.25, reason: 'اتفاق خاص' });
  assert.equal(r.status, 200); assert.equal(r.json.commissionRate, 0.25); assert.equal(r.json.id, t.id); assert.ok('availableBalance' in r.json && 'ratingCount' in r.json);
  const v = c.q.get<any>('SELECT * FROM teacher_verifications WHERE teacher_id = ? ORDER BY id DESC LIMIT 1', t.id);
  assert.equal(c.q.val('SELECT COUNT(*) FROM teacher_verifications WHERE teacher_id = ?', t.id), before + 1);
  assert.equal(v.decision, 'verified'); assert.equal(v.reviewer_id, admin.id); assert.ok(v.reason.startsWith('commission: 0.2→0.25 — اتفاق خاص'), v.reason);
  const a = auditRows('teacher.update', t.id); assert.equal(a.length, 1);
  const meta = JSON.parse(a[0].meta); assert.equal(meta.before.commissionRate, 0.2); assert.equal(meta.after.commissionRate, 0.25); assert.equal(meta.reason, 'اتفاق خاص');
  const h = await patch(t.id, admin.token, { headline: 'معلّم فيزياء', yearsExp: 7, reason: 'تحديث البيانات' });
  assert.equal(h.status, 200); assert.equal(h.json.headline, 'معلّم فيزياء'); assert.equal(h.json.yearsExp, 7);
  assert.equal(c.q.val('SELECT COUNT(*) FROM teacher_verifications WHERE teacher_id = ?', t.id), before + 1, 'بلا صفّ تحقّق جديد');
  // معلّم معلّق: decision لا يقبل pending → يُسجَّل under_review دون تغيير حالته
  assert.equal((await patch(pending.id, admin.token, { commissionRate: 0.15, reason: 'عرض انضمام' })).status, 200);
  assert.equal(c.q.val('SELECT decision FROM teacher_verifications WHERE teacher_id = ? ORDER BY id DESC LIMIT 1', pending.id), 'under_review');
  assert.equal(c.q.val('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', pending.id), 'pending');
});

test('الأرباح والتقييمات والطلاب: الأشكال، والمتعلّم مرجع فقط بلا هاتف أو بريد أو معرّف حساب', async () => {
  const t = await c.teacher('97000021');
  const p = await c.parent('97000022', [{ name: 'سارة', grade: 12, subjects: ['physics'] }, { name: 'محمد', grade: 11, subjects: ['math'] }]);
  const s = await c.student('97000023');
  const legacy = await c.student('97000024');
  const finance = await c.staff('97000025', 'finance');
  const support = await c.staff('97000026', 'support');
  const [sara, mohammed] = p.learnerIds as [number, number];
  booking(p.id, t.id, sara, 'completed', -48); booking(p.id, t.id, sara, 'completed', -24); booking(p.id, t.id, mohammed, 'confirmed', 48);
  booking(s.id, t.id, s.learnerId, 'completed', -72); booking(legacy.id, t.id, null, 'completed', -96);
  booking(s.id, t.id, s.learnerId, 'cancelled_by_student', -10);
  c.q.run("INSERT INTO teacher_earnings (teacher_id, source_type, source_id, gross, commission, net, status) VALUES (?,?,?,?,?,?,?)", t.id, 'lesson', 1, 6, 1.2, 4.8, 'available');
  c.q.run("INSERT INTO teacher_earnings (teacher_id, source_type, source_id, gross, commission, net, status) VALUES (?,?,?,?,?,?,?)", t.id, 'book', 1, 3, 0.6, 2.4, 'pending');
  c.q.run("INSERT INTO reviews (user_id, target_type, target_id, rating, comment, gate_type, gate_id) VALUES (?,?,?,?,?,'booking',1)", s.id, 'teacher', t.id, 4, 'جيد');

  assert.equal((await c.api(`/api/admin/teachers/${t.id}/earnings`, { token: support.token })).status, 403, 'الأرباح للمالية');
  const e = await c.api(`/api/admin/teachers/${t.id}/earnings`, { token: finance.token });
  assert.equal(e.status, 200); assert.equal(e.json.data.length, 2); assert.equal(e.json.meta.total, 2);
  assert.deepEqual(e.json.totals, { gross: 9, commission: 1.8, net: 7.2 });
  assert.deepEqual(Object.keys(e.json.data[0]).sort(), ['availableAt', 'commission', 'createdAt', 'gross', 'id', 'net', 'payoutId', 'refId', 'source', 'status'].sort());
  const avail = await c.api(`/api/admin/teachers/${t.id}/earnings?status=available`, { token: finance.token });
  assert.equal(avail.json.data.length, 1); assert.equal(avail.json.totals.net, 4.8);

  const rv = await c.api(`/api/admin/teachers/${t.id}/reviews`, { token: support.token });
  assert.equal(rv.status, 200); assert.ok(Array.isArray(rv.json)); assert.equal(rv.json.length, 1);
  assert.ok(ReviewAdmin.safeParse(rv.json[0]).success); assert.equal(rv.json[0].author.id, s.id); assert.equal(rv.json[0].targetTitle, `معلّم 021`);

  const st = await c.api(`/api/admin/teachers/${t.id}/students`, { token: support.token });
  assert.equal(st.status, 200); assert.equal(st.json.data.length, 4); assert.equal(st.json.meta.total, 4);
  for (const row of st.json.data) {
    assert.deepEqual(Object.keys(row), ['learner', 'account', 'lessons', 'lastAt']);
    assert.deepEqual(Object.keys(row.learner), ['id', 'displayName', 'gradeName', 'avatarUrl']);
    assert.ok(TeacherStudentRow.safeParse(row).success, JSON.stringify(row));
  }
  const saraRow = st.json.data.find((r: any) => r.learner.id === sara);
  assert.equal(saraRow.lessons, 2); assert.equal(saraRow.account.id, p.id); assert.equal(saraRow.learner.displayName, 'سارة'); assert.ok(saraRow.learner.gradeName);
  assert.equal(st.json.data.find((r: any) => r.learner.id === mohammed).lessons, 1, 'الحصة المؤكّدة تُحسب');
  const legacyRow = st.json.data.find((r: any) => r.account.id === legacy.id);
  assert.equal(legacyRow.learner.id, -legacy.id, 'حجز بلا متعلّم → مرجع اصطناعي بمعرّف سالب');
  const dump = JSON.stringify(st.json);
  assert.ok(!dump.includes('97000022') && !dump.includes('phone') && !dump.includes('email') && !dump.includes('accountId'));
  assert.equal((await c.api('/api/admin/teachers/999999/students', { token: support.token })).status, 404);
});

test('GET /admin/teachers/:id: بيانات الصرف للمالية فقط، والإحصاءات والمحتوى والتوفّر؛ القائمة بمرشّحات المادة والصف والتقييم', async () => {
  const t = await c.teacher('97000031');
  const mathTeacher = await c.teacher('97000032', { subject: 'math' });
  const s = await c.student('97000033');
  const finance = await c.staff('97000034', 'finance');
  const support = await c.staff('97000035', 'support');
  c.q.run("UPDATE teacher_profiles SET payout_method = 'bank', payout_details = ?, rating_avg = 4.5, rating_count = 2, available_balance = 12.5 WHERE user_id = ?", JSON.stringify({ iban: 'OM12' }), t.id);
  c.q.run("INSERT INTO lesson_packages (teacher_id, lessons_count, duration_minutes, mode, price, active) VALUES (?,?,?,?,?,1)", t.id, 5, 60, 'individual', 25);
  c.q.run('INSERT INTO teacher_time_off (teacher_id, starts_at, ends_at, reason) VALUES (?,?,?,?)', t.id, c.slotIn(24), c.slotIn(48), 'سفر');
  booking(s.id, t.id, s.learnerId, 'completed', -30); booking(s.id, t.id, s.learnerId, 'confirmed', 30); booking(s.id, t.id, s.learnerId, 'no_show', -50);
  c.book(t.id);
  const sup = await c.api(`/api/admin/teachers/${t.id}`, { token: support.token });
  assert.equal(sup.status, 200);
  assert.equal(sup.json.payoutMethod, null); assert.equal(sup.json.payoutDetails, null);
  assert.equal(sup.json.userId, t.id); assert.equal(sup.json.ratingCount, 2); assert.equal(sup.json.ratingAvg, 4.5); assert.deepEqual(sup.json.teachingStyle, []);
  assert.equal(sup.json.packages.length, 1); assert.equal(sup.json.packages[0].lessonsCount, 5); assert.equal(sup.json.packages[0].active, true);
  assert.equal(sup.json.availability.length, 7); assert.ok('slotMinutes' in sup.json.availability[0]);
  assert.equal(sup.json.timeOff.length, 1); assert.equal(sup.json.timeOff[0].reason, 'سفر'); assert.ok(sup.json.timeOff[0].from);
  assert.equal(sup.json.content.books.length, 1); assert.deepEqual(sup.json.content.courses, []);
  assert.deepEqual(sup.json.stats.bookings, { total: 3, completed: 1, cancelledByTeacher: 0, noShow: 1, disputed: 0, upcoming: 1 });
  assert.deepEqual(sup.json.stats.earnings, { lifetime: 0, available: 12.5, pending: 0 });
  assert.deepEqual(sup.json.stats.reviews, { avg: 4.5, count: 2, hidden: 0 });
  assert.equal(sup.json.subjects[0].subject, 'الفيزياء'); assert.ok(sup.json.subjects[0].subjectId);
  const fin = await c.api(`/api/admin/teachers/${t.id}`, { token: finance.token });
  assert.equal(fin.status, 200); assert.equal(fin.json.payoutMethod, 'bank'); assert.deepEqual(fin.json.payoutDetails, { iban: 'OM12' });
  // القائمة
  const list = (qs: string) => c.api(`/api/admin/teachers?${qs}`, { token: support.token }).then(r => r.json.data.map((x: any) => x.id));
  assert.ok((await list(`subjectId=${c.cat.subjects.physics}`)).includes(t.id));
  assert.ok(!(await list(`subjectId=${c.cat.subjects.math}`)).includes(t.id));
  assert.ok((await list(`subjectId=${c.cat.subjects.math}&gradeId=${c.cat.grades[12]}`)).includes(mathTeacher.id));
  assert.ok(!(await list(`gradeId=${c.cat.grades[11]}`)).includes(t.id));
  const rated = await list('minRating=4&sort=rating_desc'); assert.equal(rated[0], t.id); assert.ok(!rated.includes(mathTeacher.id));
  const rows = (await c.api(`/api/admin/teachers?q=${t.id}`, { token: support.token })).json.data;
  assert.equal(rows.length, 1); assert.equal(rows[0].ratingCount, 2); assert.equal(rows[0].studentsCount, 0); assert.equal(rows[0].availableBalance, 12.5); assert.equal(rows[0].commissionRate, 0.2);
  assert.equal((await c.api('/api/admin/teachers?sort=bogus', { token: support.token })).status, 422);
});

test('GET /admin/overview?days=: السلاسل بطول المدى، والأقسام الحيّة، وذاكرة ١٥ ثانية', async () => {
  const support = await c.staff('97000041', 'support');
  const bad = await c.api('/api/admin/overview?days=5', { token: support.token });
  assert.equal(bad.status, 422);
  const r = await c.api('/api/admin/overview?days=7', { token: support.token });
  assert.equal(r.status, 200);
  const o = r.json;
  assert.equal(o.series.days.length, 7);
  assert.equal(o.series.days[6], new Date().toISOString().slice(0, 10), 'آخر يوم هو اليوم');
  for (const k of ['revenue', 'refunds', 'bookings', 'completed', 'newUsers', 'newLearners']) assert.equal(o.series[k].length, 7, k);
  assert.ok(o.series.newUsers.reduce((a: number, b: number) => a + b, 0) >= 1, 'مستخدمو هذا الملف ضمن السلسلة');
  assert.deepEqual(Object.keys(o.live).sort(), ['connectedSockets', 'gmvToday', 'inProgress', 'lessonsInProgress', 'lessonsNextHour', 'openDisputes', 'openReports', 'pendingPaymentBookings', 'refundsToday', 'teacherPayable', 'walletLiability'].sort());
  assert.deepEqual(Object.keys(o.breakdown.revenueByItemType).sort(), ['book', 'course', 'lesson', 'package', 'subscription']);
  assert.equal(Object.keys(o.breakdown.bookingsByStatus).length, 9);
  assert.ok('books' in o.breakdown.contentByStatus && 'courses' in o.breakdown.contentByStatus && 'ordersByProvider' in o.breakdown);
  assert.ok(Array.isArray(o.top.teachers) && Array.isArray(o.top.subjects));
  assert.equal(o.reports, o.queues.reports); assert.equal(typeof o.queues.disputes, 'number'); assert.equal(typeof o.queues.pendingDocuments, 'number');
  assert.ok(['total', 'students', 'parents', 'learners', 'learnersByGrade', 'newThisMonth', 'newToday', 'activeUsers24h'].every(k => k in o.users));
  assert.ok(o.users.students >= 1 && o.users.parents >= 1 && o.users.learners >= 3, 'الطلاب وأولياء الأمور من المتعلّمين');
  assert.ok('teachers' in o && 'bookings' in o && 'revenue' in o, 'الحقول القديمة باقية');
  // ذاكرة ١٥ ثانية: طلب ثانٍ يعيد الكائن نفسه رغم تغيّر البيانات
  await c.student('97000042');
  const again = await c.api('/api/admin/overview?days=7', { token: support.token });
  assert.deepEqual(again.json, o);
  assert.equal((await c.api('/api/admin/overview?days=90', { token: support.token })).json.series.days.length, 90);
  assert.equal((await c.api('/api/admin/overview', { token: support.token })).json.series.days.length, 14, 'الافتراضي ١٤');
});
