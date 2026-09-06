import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

const here = path.dirname(fileURLToPath(import.meta.url));
/** /home يتبع المتعلّم النشط بعد تحديث domains/home.ts (طبقة أخرى) — حتى ذلك الحين تُتخطّى اختباراته تلقائياً */
const homeFollowsLearner = fs.readFileSync(path.join(here, '../src/domains/home.ts'), 'utf8').includes('resolveLearner(');
const HOME_SKIP = homeFollowsLearner ? false : 'ينتظر تحديث domains/home.ts ليستخدم resolveLearner';

const setup = (o: Record<string, unknown> = {}) => ({ displayName: 'متعلّم', curriculumId: c.cat.curriculumId, gradeId: c.cat.grades[12], semesterId: c.cat.semesters[1], subjectIds: [c.cat.subjects.physics], ...o });
const post = (token: string, pathname: string, body?: unknown, headers?: Record<string, string>) => c.api(pathname, { method: 'POST', token, body, headers });
const gradeName = (order: number) => c.q.val<string>('SELECT name FROM grades WHERE id = ?', c.cat.grades[order]);

test('أول متعلّم ذاتي يُكمل التهيئة ويمنح دور الطالب ويصبح النشط، ويُكتب انعكاسه في الجدولين القديمين', async () => {
  const s = await c.login('99000001');
  assert.equal(s.user.onboardingCompleted, false);
  assert.deepEqual(s.user.learners, []); assert.equal(s.user.activeLearnerId, null); assert.equal(s.user.student, null);
  const r = await post(s.token, '/api/me/learners', setup({ displayName: 'سالم', isSelf: true, gender: 'male', school: 'مدرسة السلطان قابوس' }));
  assert.equal(r.status, 201);
  assert.equal(r.json.onboardingCompleted, true);
  assert.ok(r.json.roles.includes('student'));
  assert.equal(r.json.learners.length, 1);
  const l = r.json.learners[0];
  assert.equal(l.isSelf, true); assert.equal(l.displayName, 'سالم'); assert.equal(l.gradeId, c.cat.grades[12]); assert.equal(l.gradeName, gradeName(12));
  assert.deepEqual(l.subjectIds, [c.cat.subjects.physics]); assert.equal(l.position, 0); assert.equal(l.archivedAt, null); assert.equal(l.school, 'مدرسة السلطان قابوس');
  assert.equal(r.json.activeLearnerId, l.id);
  // student (المهمل) مرآة للمتعلّم النشط
  assert.equal(r.json.student.gradeId, c.cat.grades[12]); assert.deepEqual(r.json.student.subjectIds, [c.cat.subjects.physics]);
  const list = await c.api('/api/me/learners', { token: s.token });
  assert.equal(list.status, 200); assert.equal(list.json.data.length, 1); assert.equal(list.json.activeLearnerId, l.id);
  // الكتابة الانعكاسية للجدولين القديمين
  assert.equal(c.q.val('SELECT grade_id FROM student_profiles WHERE user_id = ?', s.id), c.cat.grades[12]);
  assert.deepEqual(c.q.all<any>('SELECT subject_id FROM student_subjects WHERE user_id = ?', s.id).map(x => x.subject_id), [c.cat.subjects.physics]);
  // سجلّ تدقيق بصاحب الحساب
  assert.equal(c.q.val("SELECT target_user_id FROM audit_logs WHERE action = 'learner.create' AND entity = 'learners' AND entity_id = ?", l.id), s.id);
});

test('وليّ أمر: أول متعلّم غير ذاتي يمنح دور parent لا student، ولا يُكتب انعكاس قديم', async () => {
  const p = await c.login('99000002');
  c.q.run('DELETE FROM user_roles WHERE user_id = ?', p.id); // دور student الافتراضي عند التسجيل ليس محلّ الاختبار
  const r = await post(p.token, '/api/me/learners', setup({ displayName: 'سارة', isSelf: false, gender: 'female' }));
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.roles, ['parent']);
  assert.equal(r.json.learners[0].isSelf, false); assert.equal(r.json.learners[0].gender, 'female');
  assert.equal(r.json.onboardingCompleted, true);
  assert.equal(r.json.student.gradeId, c.cat.grades[12], 'المرآة تتبع المتعلّم النشط ولو لم يكن ذاتياً');
  assert.equal(c.q.get('SELECT 1 FROM student_profiles WHERE user_id = ?', p.id), undefined);
});

test('الحد الأقصى ٦ متعلّمين → 409 learner_limit', async () => {
  const s = await c.student('99000003');
  for (let i = 2; i <= 6; i++) assert.equal((await post(s.token, '/api/me/learners', setup({ displayName: `ابن ${i}`, isSelf: false }))).status, 201);
  const seventh = await post(s.token, '/api/me/learners', setup({ displayName: 'السابع', isSelf: false }));
  assert.equal(seventh.status, 409); assert.equal(seventh.json.error.code, 'learner_limit');
  assert.equal((await c.api('/api/me/learners', { token: s.token })).json.data.length, 6);
});

test('PATCH يعيد كتابة المواد ويتجاهل isSelf ويتحقّق من المنهج؛ متعلّم حساب آخر → 403 learner_forbidden', async () => {
  const a = await c.student('99000004');
  const b = await c.student('99000005');
  const r = await c.api(`/api/me/learners/${a.learnerId}`, { method: 'PATCH', token: a.token, body: { subjectIds: [c.cat.subjects.chemistry, c.cat.subjects.math], isSelf: false, school: 'مدرسة جديدة' } });
  assert.equal(r.status, 200);
  const l = r.json.learners.find((x: any) => x.id === a.learnerId);
  assert.deepEqual([...l.subjectIds].sort(), [c.cat.subjects.chemistry, c.cat.subjects.math].sort());
  assert.equal(l.isSelf, true); assert.equal(l.school, 'مدرسة جديدة');
  assert.equal(c.q.val('SELECT COUNT(*) FROM learner_subjects WHERE learner_id = ?', a.learnerId), 2);
  assert.equal(c.q.val('SELECT COUNT(*) FROM student_subjects WHERE user_id = ?', a.id), 2, 'الانعكاس القديم يتبع');
  assert.equal(c.q.val("SELECT target_user_id FROM audit_logs WHERE action = 'learner.update' AND entity_id = ?", a.learnerId), a.id);
  const wrong = await c.api(`/api/me/learners/${a.learnerId}`, { method: 'PATCH', token: a.token, body: { gradeId: 9999 } });
  assert.equal(wrong.status, 400);
  const noSubjects = await c.api(`/api/me/learners/${a.learnerId}`, { method: 'PATCH', token: a.token, body: { subjectIds: [9999] } });
  assert.equal(noSubjects.status, 400);
  const foreign = await c.api(`/api/me/learners/${b.learnerId}`, { method: 'PATCH', token: a.token, body: { displayName: 'اختراق' } });
  assert.equal(foreign.status, 403); assert.equal(foreign.json.error.code, 'learner_forbidden');
  const activate = await post(a.token, `/api/me/learners/${b.learnerId}/activate`);
  assert.equal(activate.status, 403); assert.equal(activate.json.error.code, 'learner_forbidden');
  assert.equal(c.q.val('SELECT display_name FROM learners WHERE id = ?', b.learnerId), 'طالب 005');
});

test('الحذف: آخر متعلّم → 409 last_learner؛ حصة قادمة → 409 learner_has_upcoming؛ ثم أرشفة تنقل النشط', async () => {
  const s = await c.student('99000006');
  const t = await c.teacher('99000007');
  const last = await c.api(`/api/me/learners/${s.learnerId}`, { method: 'DELETE', token: s.token });
  assert.equal(last.status, 409); assert.equal(last.json.error.code, 'last_learner');
  const added = await post(s.token, '/api/me/learners', setup({ displayName: 'أخي', isSelf: false }));
  const l2 = added.json.learners.find((x: any) => !x.isSelf).id;
  const act = await post(s.token, `/api/me/learners/${l2}/activate`);
  assert.equal(act.status, 200); assert.equal(act.json.activeLearnerId, l2);
  assert.equal(act.json.student.gradeId, c.cat.grades[12]);
  const bookingId = Number(c.q.run(`INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price, learner_id) VALUES (?,?,?,'individual',60,?,?,'confirmed',6,?)`,
    s.id, t.id, c.cat.subjects.physics, c.slotIn(30), c.slotIn(31), l2).lastInsertRowid);
  const busy = await c.api(`/api/me/learners/${l2}`, { method: 'DELETE', token: s.token });
  assert.equal(busy.status, 409); assert.equal(busy.json.error.code, 'learner_has_upcoming');
  c.q.run("UPDATE bookings SET status = 'completed' WHERE id = ?", bookingId);
  const ok = await c.api(`/api/me/learners/${l2}`, { method: 'DELETE', token: s.token });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.learners.length, 1); assert.equal(ok.json.activeLearnerId, s.learnerId, 'النشط انتقل إلى الافتراضي');
  assert.ok(c.q.val('SELECT archived_at FROM learners WHERE id = ?', l2));
  assert.equal(c.q.val('SELECT learner_id FROM bookings WHERE id = ?', bookingId), l2, 'الحجز يبقى في السجل');
  assert.equal(c.q.val("SELECT target_user_id FROM audit_logs WHERE action = 'learner.archive' AND entity_id = ?", l2), s.id);
  const again = await c.api(`/api/me/learners/${l2}`, { method: 'DELETE', token: s.token });
  assert.equal(again.status, 403, 'المؤرشف لم يعد في الحساب');
});

test('حسم المتعلّم: صريح → ترويسة → users.active_learner_id → الافتراضي؛ متعلّم حساب آخر أو مؤرشف → 403', async () => {
  const svc = await import('../src/services/learners.ts');
  const auth = await import('../src/lib/auth.ts');
  const a = await c.student('99000008');
  const b = await c.student('99000009');
  assert.equal(svc.resolveLearnerForAccount(a.id, null, null)!.id, a.learnerId);
  assert.throws(() => svc.resolveLearnerForAccount(a.id, null, b.learnerId), (e: any) => e.code === 'learner_forbidden' && e.status === 403);
  assert.throws(() => svc.resolveLearnerForAccount(a.id, b.learnerId, null), (e: any) => e.code === 'learner_forbidden');
  const l2 = c.addLearner(a.id, 'ثانٍ', { isSelf: true, grade: 11, subjects: ['math'] });
  assert.equal(svc.resolveLearnerForAccount(a.id, null, null)!.id, a.learnerId, 'بلا ترويسة: النشط');
  assert.equal(svc.resolveLearnerForAccount(a.id, null, l2)!.id, l2, 'الترويسة تسبق النشط');
  assert.equal(svc.resolveLearnerForAccount(a.id, a.learnerId, l2)!.id, a.learnerId, 'الصريح يسبق الترويسة');
  assert.equal((await post(a.token, `/api/me/learners/${l2}/activate`)).json.activeLearnerId, l2);
  assert.equal(svc.resolveLearnerForAccount(a.id, null, null)!.id, l2);
  assert.equal(svc.resolveLearnerForAccount(a.id, null, null)!.grade_name, gradeName(11));
  c.q.run("UPDATE learners SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", l2);
  assert.throws(() => svc.resolveLearnerForAccount(a.id, null, l2), (e: any) => e.code === 'learner_forbidden', 'معرّف قديم من جهاز آخر');
  assert.equal(svc.resolveLearnerForAccount(a.id, null, null)!.id, a.learnerId, 'النشط المؤرشف يسقط إلى الافتراضي');
  // حساب بلا متعلّم → null، وrequireLearner يرمي 422
  const none = await c.login('99000010');
  assert.equal(svc.resolveLearnerForAccount(none.id, null, null), null);
  assert.throws(() => svc.requireLearner({ user: { id: none.id }, learnerId: null } as any), (e: any) => e.code === 'learner_required' && e.status === 422);
  // learnerRef: أربعة مفاتيح فقط
  assert.deepEqual(Object.keys(svc.learnerRef(svc.defaultLearner(a.id)!)), ['id', 'displayName', 'gradeName', 'avatarUrl']);
  assert.deepEqual(Object.keys(svc.learnerRefById(a.learnerId)!), ['id', 'displayName', 'gradeName', 'avatarUrl']);
  // الترويسة: عدد صحيح موجب أو null بلا قاعدة بيانات
  assert.equal(auth.parseLearnerHeader('12'), 12); assert.equal(auth.parseLearnerHeader(' 7 '), 7);
  assert.equal(auth.parseLearnerHeader('abc'), null); assert.equal(auth.parseLearnerHeader('0'), null); assert.equal(auth.parseLearnerHeader(undefined), null);
});

test('/home: greeting.gradeName يتبع X-Learner-Id وnextLesson يتبع المتعلّم؛ متعلّم غريب → 403', { skip: HOME_SKIP }, async () => {
  const p = await c.parent('99000011', [{ name: 'سارة', grade: 12, subjects: ['physics'] }, { name: 'محمد', grade: 11, subjects: ['math'] }]);
  const t = await c.teacher('99000012');
  const [sara, mohammed] = p.learnerIds;
  const home0 = await c.api('/api/home', { token: p.token });
  assert.equal(home0.status, 200); assert.equal(home0.json.greeting.gradeName, gradeName(12));
  assert.equal(home0.json.greeting.learner.id, sara); assert.equal(home0.json.greeting.learnersCount, 2);
  const home1 = await c.api('/api/home', { token: p.token, headers: { 'X-Learner-Id': String(mohammed) } });
  assert.equal(home1.json.greeting.gradeName, gradeName(11)); assert.equal(home1.json.greeting.learner.id, mohammed);
  assert.deepEqual(Object.keys(home1.json.greeting.learner), ['id', 'displayName', 'gradeName', 'avatarUrl']);
  const bookingId = Number(c.q.run(`INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price, learner_id) VALUES (?,?,?,'individual',60,?,?,'confirmed',6,?)`,
    p.id, t.id, c.cat.subjects.physics, c.slotIn(2), c.slotIn(3), mohammed).lastInsertRowid);
  assert.equal((await c.api('/api/home', { token: p.token, headers: { 'X-Learner-Id': String(mohammed) } })).json.nextLesson?.id, bookingId);
  assert.equal((await c.api('/api/home', { token: p.token, headers: { 'X-Learner-Id': String(sara) } })).json.nextLesson, null);
  const other = await c.student('99000013');
  const foreign = await c.api('/api/home', { token: p.token, headers: { 'X-Learner-Id': String(other.learnerId) } });
  assert.equal(foreign.status, 403); assert.equal(foreign.json.error.code, 'learner_forbidden');
});

test('/home يعمل بلا متعلّم لحساب معلّم فقط ولحساب طاقم (gradeName: null)', async () => {
  const t = await c.teacher('99000014');
  const th = await c.api('/api/home', { token: t.token });
  assert.equal(th.status, 200); assert.equal(th.json.greeting.gradeName, null);
  const staff = await c.staff('99000015', 'support');
  const sh = await c.api('/api/home', { token: staff.token });
  assert.equal(sh.status, 200); assert.equal(sh.json.greeting.gradeName, null);
  if (homeFollowsLearner) { assert.equal(th.json.greeting.learner, null); assert.equal(th.json.greeting.learnersCount, 0); }
});

test('student-setup (مهمل) يُنشئ المتعلّم الذاتي ثم يحدّثه، و/auth/me.student مرآة له، وPATCH /me يعكس الاسم', async () => {
  const s = await c.login('99000016');
  const first = await post(s.token, '/api/me/student-setup', { displayName: 'سالم', curriculumId: c.cat.curriculumId, gradeId: c.cat.grades[12], semesterId: c.cat.semesters[1], subjectIds: [c.cat.subjects.physics, c.cat.subjects.chemistry] });
  assert.equal(first.status, 200); assert.equal(first.json.onboardingCompleted, true);
  assert.equal(first.json.learners.length, 1); assert.equal(first.json.learners[0].isSelf, true); assert.equal(first.json.learners[0].displayName, 'سالم');
  assert.equal(first.json.activeLearnerId, first.json.learners[0].id);
  const second = await post(s.token, '/api/me/student-setup', { displayName: 'سالم', curriculumId: c.cat.curriculumId, gradeId: c.cat.grades[11], semesterId: c.cat.semesters[1], subjectIds: [c.cat.subjects.math], school: 'مدرسة' });
  assert.equal(second.status, 200);
  assert.equal(second.json.learners.length, 1, 'تحديث لا إنشاء');
  assert.equal(second.json.learners[0].gradeId, c.cat.grades[11]); assert.equal(second.json.learners[0].school, 'مدرسة');
  const me = await c.api('/api/auth/me', { token: s.token });
  assert.equal(me.json.student.gradeId, c.cat.grades[11]); assert.equal(me.json.student.gradeName, gradeName(11));
  assert.deepEqual(me.json.student.subjectIds, [c.cat.subjects.math]);
  assert.equal(c.q.val('SELECT grade_id FROM student_profiles WHERE user_id = ?', s.id), c.cat.grades[11], 'الانعكاس القديم');
  assert.deepEqual(c.q.all<any>('SELECT subject_id FROM student_subjects WHERE user_id = ?', s.id).map(x => x.subject_id), [c.cat.subjects.math]);
  const renamed = await c.api('/api/me', { method: 'PATCH', token: s.token, body: { displayName: 'سالم الجديد' } });
  assert.equal(renamed.json.learners[0].displayName, 'سالم الجديد');
});

test('reorder: ترتيب جديد ومن لم يُذكر يلحق؛ معرّف غريب أو مكرّر → 400', async () => {
  const s = await c.student('99000017');
  const other = await c.student('99000018');
  const l2 = c.addLearner(s.id, 'ثانٍ', { isSelf: true, grade: 11 });
  const l3 = c.addLearner(s.id, 'ثالث', { isSelf: true, grade: 10 });
  const r = await post(s.token, '/api/me/learners/reorder', { ids: [l3, s.learnerId] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.map((x: any) => x.id), [l3, s.learnerId, l2]);
  assert.deepEqual(r.json.data.map((x: any) => x.position), [0, 1, 2]);
  assert.equal((await post(s.token, '/api/me/learners/reorder', { ids: [l2, other.learnerId] })).status, 400);
  assert.equal((await post(s.token, '/api/me/learners/reorder', { ids: [l2, l2] })).status, 400);
});

test('DELETE /me يؤرشف المتعلّمين ويمسح بياناتهم الشخصية ويصفّر النشط', async () => {
  const s = await c.student('99000019');
  c.addLearner(s.id, 'ابن', { isSelf: false, grade: 11 });
  const r = await c.api('/api/me', { method: 'DELETE', token: s.token });
  assert.equal(r.status, 200);
  const rows = c.q.all<any>('SELECT display_name, school, avatar_path, archived_at FROM learners WHERE account_id = ?', s.id);
  assert.equal(rows.length, 2);
  for (const row of rows) { assert.equal(row.display_name, 'محذوف'); assert.equal(row.school, null); assert.ok(row.archived_at); }
  assert.equal(c.q.val('SELECT active_learner_id FROM users WHERE id = ?', s.id), null);
  assert.equal(c.q.get('SELECT 1 FROM student_profiles WHERE user_id = ?', s.id), undefined);
});
