import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PersonDetail, SessionRow } from '@manassah/shared';
import { boot, type Ctx } from './helpers.ts';

/** صفحة الشخص (Person 360): البطاقة، المحفظة، الحالة، الأدوار، الاستحقاقات، التقييمات، الجلسات، الملف، المتعلّمون — كلّها مسجَّلة بـ target_user_id */
let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

const post = (token: string, pathname: string, body?: unknown) => c.api(pathname, { method: 'POST', token, body });
const auditRows = (action: string, target: number) => c.q.all<any>('SELECT * FROM audit_logs WHERE action = ? AND target_user_id = ? ORDER BY id', action, target);

test('GET /admin/users/:id يطابق PersonDetail ويقنّع معرّف المزوّد', async () => {
  const s = await c.student('96000001');
  const support = await c.staff('96000002', 'support');
  const r = await c.api(`/api/admin/users/${s.id}`, { token: support.token });
  assert.equal(r.status, 200);
  const parsed = PersonDetail.safeParse(r.json);
  assert.ok(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues));
  assert.equal(r.json.id, s.id);
  assert.equal(r.json.identities.length, 1);
  const uid = r.json.identities[0].providerUid as string;
  assert.ok(uid.endsWith('***') && uid.length === 6, `معرّف مقنَّع: ${uid}`);
  assert.ok(!JSON.stringify(r.json.identities).includes('96000001'), 'الهاتف الكامل لا يظهر في الهويات');
  assert.equal(r.json.learners.length, 1); assert.equal(r.json.learners[0].bookingsCount, 0); assert.equal(r.json.activeLearnerId, s.learnerId);
  assert.deepEqual(r.json.wallet, { balance: 0, currency: 'OMR' });
  assert.ok(r.json.counts.activeSessions >= 1); assert.equal(r.json.teacher, null); assert.equal(r.json.roles[0].role, 'student');
  assert.equal((await c.api('/api/admin/users/999999', { token: support.token })).status, 404);
  assert.equal((await c.api(`/api/admin/users/${s.id}`, { token: s.token })).status, 403);
});

test('تعديل المحفظة: المالية فقط، الحدّ ٥٠٠، ملاحظة ≥ ٥، الرصيد لا يصبح سالباً، ويُسجَّل ويُبلَّغ', async () => {
  const s = await c.student('96000011');
  const finance = await c.staff('96000012', 'finance');
  const support = await c.staff('96000013', 'support');
  const path = `/api/admin/users/${s.id}/wallet/adjust`;
  assert.equal((await post(support.token, path, { amount: 10, note: 'تعويض عن حصة' })).status, 403, 'الدعم لا يعدّل الرصيد');
  assert.equal((await post(finance.token, path, { amount: 600, note: 'تعويض عن حصة' })).status, 422, 'فوق الحدّ');
  assert.equal((await post(finance.token, path, { amount: 10, note: 'قصير' })).status, 422, 'ملاحظة قصيرة');
  assert.equal((await post(finance.token, path, { amount: 0, note: 'تعويض عن حصة' })).status, 422, 'صفر');
  const ok = await post(finance.token, path, { amount: 10, note: 'تعويض عن حصة ملغاة' });
  assert.equal(ok.status, 200); assert.equal(ok.json.balance, 10);
  const neg = await post(finance.token, path, { amount: -50, note: 'خصم تجريبي' });
  assert.equal(neg.status, 400); assert.equal(neg.json.error.code, 'insufficient_funds');
  const tx = c.q.get<any>("SELECT * FROM wallet_transactions WHERE user_id = ? AND type = 'adjustment'", s.id);
  assert.ok(tx && tx.amount === 10 && tx.ref_type === 'admin' && tx.ref_id === finance.id);
  const a = auditRows('wallet.adjust', s.id); assert.equal(a.length, 1); assert.equal(a[0].actor_id, finance.id); assert.equal(JSON.parse(a[0].meta).amount, 10);
  assert.ok(c.q.get("SELECT 1 FROM notifications WHERE user_id = ? AND type = 'wallet_adjusted'", s.id));
  const ledger = await c.api(`/api/admin/users/${s.id}/wallet`, { token: support.token });
  assert.equal(ledger.status, 200); assert.equal(ledger.json.balance, 10); assert.equal(ledger.json.data.length, 1); assert.equal(ledger.json.data[0].balanceAfter, 10); assert.equal(ledger.json.meta.total, 1);
  const bonus = await post(finance.token, path, { amount: 5, type: 'bonus', note: 'رصيد ترحيبي' });
  assert.equal(bonus.json.balance, 15);
});

test('الحالة: الإيقاف يحتاج سبباً ويُسجّل من أوقف ويُنهي الجلسات؛ الذات ممنوعة؛ الحذف لـ super_admin ويمسح', async () => {
  const s = await c.student('96000021');
  const admin = await c.staff('96000022', 'admin');
  const superAdmin = await c.staff('96000023', 'super_admin');
  const path = `/api/admin/users/${s.id}/status`;
  assert.equal((await post(admin.token, path, { status: 'suspended' })).status, 422, 'السبب مطلوب');
  const self = await post(admin.token, `/api/admin/users/${admin.id}/status`, { status: 'suspended', reason: 'تجربة' });
  assert.equal(self.status, 400); assert.equal(self.json.error.code, 'self_target');
  const sus = await post(admin.token, path, { status: 'suspended', reason: 'مخالفة الشروط' });
  assert.equal(sus.status, 200); assert.equal(sus.json.status, 'suspended'); assert.equal(sus.json.statusReason, 'مخالفة الشروط'); assert.equal(sus.json.suspendedBy.id, admin.id); assert.ok(sus.json.suspendedAt);
  const u = c.q.get<any>('SELECT * FROM users WHERE id = ?', s.id);
  assert.equal(u.status_reason, 'مخالفة الشروط'); assert.equal(u.suspended_by, admin.id);
  assert.equal((await c.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } })).status, 401, 'رمز التجديد أُبطل');
  assert.equal(auditRows('user.suspended', s.id).length, 1);
  const back = await post(admin.token, path, { status: 'active' });
  assert.equal(back.status, 200); assert.equal(back.json.status, 'active'); assert.equal(back.json.statusReason, null); assert.equal(back.json.suspendedBy, null);
  assert.equal((await post(admin.token, path, { status: 'deleted', reason: 'طلب المستخدم' })).status, 403, 'الحذف لـ super_admin');
  const del = await post(superAdmin.token, path, { status: 'deleted', reason: 'طلب المستخدم' });
  assert.equal(del.status, 200); assert.equal(del.json.status, 'deleted'); assert.equal(del.json.phone, null);
  assert.equal(c.q.val('SELECT status FROM users WHERE id = ?', s.id), 'deleted');
  assert.equal(c.q.val('SELECT display_name FROM learners WHERE id = ?', s.learnerId), 'محذوف');
  assert.ok(c.q.val('SELECT archived_at FROM learners WHERE id = ?', s.learnerId));
  assert.equal(c.q.get('SELECT 1 FROM student_profiles WHERE user_id = ?', s.id), undefined, 'الانعكاس القديم يُمسح');
  assert.equal(auditRows('user.deleted', s.id).length, 1);
});

test('الأدوار: admin يمنح teacher (ملفّ معلّق) لا finance؛ super_admin لا يسحب دوره؛ المعلّم المعتمد لا يُسحب دوره؛ لا صفر أدوار', async () => {
  const s = await c.student('96000031');
  const admin = await c.staff('96000032', 'admin');
  const superAdmin = await c.staff('96000033', 'super_admin');
  const t = await c.teacher('96000034');
  const lone = await c.student('96000035');
  const grant = (token: string, id: number, role: string) => post(token, `/api/admin/users/${id}/roles/grant`, { role });
  const revoke = (token: string, id: number, role: string) => post(token, `/api/admin/users/${id}/roles/revoke`, { role, reason: 'اختبار' });
  const r1 = await grant(admin.token, s.id, 'teacher');
  assert.equal(r1.status, 200); assert.ok(r1.json.roles.includes('teacher'));
  assert.equal(c.q.val('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', s.id), 'pending', 'ملفّ معلّم معلّق أُنشئ');
  assert.equal(auditRows('user.role_grant', s.id).length, 1);
  assert.equal((await grant(admin.token, s.id, 'finance')).status, 403, 'أدوار الطاقم لـ super_admin');
  const r2 = await grant(superAdmin.token, s.id, 'finance');
  assert.equal(r2.status, 200); assert.ok(r2.json.roles.includes('finance'));
  assert.equal(c.q.val('SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ? AND revoked = 0', s.id), 0, 'تغيير دور طاقم يُنهي الجلسات');
  const own = await revoke(superAdmin.token, superAdmin.id, 'super_admin');
  assert.equal(own.status, 409); assert.equal(own.json.error.code, 'self_target');
  const tv = await revoke(admin.token, t.id, 'teacher');
  assert.equal(tv.status, 409); assert.equal(tv.json.error.code, 'teacher_verified');
  const zero = await revoke(admin.token, lone.id, 'student');
  assert.equal(zero.status, 409); assert.equal(zero.json.error.code, 'conflict');
  assert.equal((await revoke(admin.token, s.id, 'finance')).status, 403);
  assert.equal((await revoke(superAdmin.token, s.id, 'finance')).status, 200);
  // المسار القديم (استبدال الكل) يطبّق الحرّاس نفسها على الفرق
  const old = await post(superAdmin.token, `/api/admin/users/${lone.id}/roles`, { roles: ['student', 'support'] });
  assert.equal(old.status, 200); assert.deepEqual([...old.json.roles].sort(), ['student', 'support']);
  const oldT = await post(superAdmin.token, `/api/admin/users/${t.id}/roles`, { roles: ['student'] });
  assert.equal(oldT.status, 409); assert.equal(oldT.json.error.code, 'teacher_verified');
  assert.equal((await post(admin.token, `/api/admin/users/${lone.id}/roles`, { roles: ['student'] })).status, 403);
});

test('الاستحقاقات: منح بتاريخ انتهاء ثم إلغاء بسبب — مسجَّلان بصاحب الحساب', async () => {
  const s = await c.student('96000041');
  const t = await c.teacher('96000042');
  const admin = await c.staff('96000043', 'admin');
  const support = await c.staff('96000044', 'support');
  const bookId = c.book(t.id);
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const g = await post(admin.token, `/api/admin/users/${s.id}/grant`, { itemType: 'book', itemId: bookId, expiresAt, note: 'هدية' });
  assert.equal(g.status, 200); assert.ok(g.json.id > 0);
  assert.equal((await post(admin.token, `/api/admin/users/${s.id}/grant`, { itemType: 'course', itemId: 999999 })).status, 404);
  const list = await c.api(`/api/admin/users/${s.id}/entitlements`, { token: support.token });
  assert.equal(list.status, 200);
  assert.equal(list.json.entitlements.length, 1);
  assert.equal(list.json.entitlements[0].id, g.json.id); assert.equal(list.json.entitlements[0].expiresAt, expiresAt); assert.equal(list.json.entitlements[0].source, 'admin'); assert.ok(list.json.entitlements[0].title);
  assert.deepEqual(Object.keys(list.json), ['entitlements', 'enrollments', 'packages', 'subscriptions']);
  assert.equal(c.q.val('SELECT expires_at FROM entitlements WHERE id = ?', g.json.id), expiresAt);
  const del = (body: unknown) => c.api(`/api/admin/users/${s.id}/entitlements/${g.json.id}`, { method: 'DELETE', token: admin.token, body });
  assert.equal((await del({ reason: 'x' })).status, 422, 'السبب ≥ ٣ أحرف');
  assert.equal((await del({ reason: 'منح بالخطأ' })).status, 204);
  assert.equal((await del({ reason: 'منح بالخطأ' })).status, 404);
  assert.equal((await c.api(`/api/admin/users/${s.id}/entitlements`, { token: support.token })).json.entitlements.length, 0);
  assert.equal(auditRows('entitlement.grant', s.id).length, 1); assert.equal(auditRows('entitlement.revoke', s.id).length, 1);
  assert.equal(JSON.parse(auditRows('entitlement.revoke', s.id)[0].meta).reason, 'منح بالخطأ');
});

test('التقييمات: الإخفاء يحتاج سبباً ويحفظ من أخفاه، والإظهار يعيد التقييم', async () => {
  const s = await c.student('96000051');
  const t = await c.teacher('96000052');
  const support = await c.staff('96000053', 'support');
  const rid = Number(c.q.run("INSERT INTO reviews (user_id, target_type, target_id, rating, comment, gate_type, gate_id) VALUES (?,?,?,?,?,'booking',1)", s.id, 'teacher', t.id, 5, 'ممتاز').lastInsertRowid);
  c.q.run('UPDATE teacher_profiles SET rating_avg = 5, rating_count = 1 WHERE user_id = ?', t.id);
  assert.equal((await post(support.token, `/api/admin/reviews/${rid}/hide`, {})).status, 422, 'السبب مطلوب');
  assert.equal((await post(support.token, `/api/admin/reviews/${rid}/hide`, { reason: 'ألفاظ غير لائقة' })).status, 200);
  const row = c.q.get<any>('SELECT * FROM reviews WHERE id = ?', rid);
  assert.equal(row.status, 'hidden'); assert.equal(row.hidden_reason, 'ألفاظ غير لائقة'); assert.equal(row.hidden_by, support.id);
  assert.equal(c.q.val('SELECT rating_count FROM teacher_profiles WHERE user_id = ?', t.id), 0);
  const written = await c.api(`/api/admin/users/${s.id}/reviews`, { token: support.token });
  assert.equal(written.status, 200); assert.equal(written.json.written.length, 1); assert.equal(written.json.written[0].status, 'hidden'); assert.equal(written.json.written[0].hiddenReason, 'ألفاظ غير لائقة');
  assert.equal(written.json.written[0].targetTitle, c.q.val('SELECT display_name FROM profiles WHERE user_id = ?', t.id));
  const received = await c.api(`/api/admin/users/${t.id}/reviews`, { token: support.token });
  assert.equal(received.json.received.length, 1); assert.equal(received.json.received[0].author.id, s.id);
  assert.equal((await post(support.token, `/api/admin/reviews/${rid}/unhide`)).status, 200);
  const after = c.q.get<any>('SELECT * FROM reviews WHERE id = ?', rid);
  assert.equal(after.status, 'published'); assert.equal(after.hidden_reason, null); assert.equal(after.hidden_by, null);
  assert.equal(c.q.val('SELECT rating_count FROM teacher_profiles WHERE user_id = ?', t.id), 1);
  assert.equal(c.q.val('SELECT rating_avg FROM teacher_profiles WHERE user_id = ?', t.id), 5);
  assert.equal(auditRows('review.hide', s.id).length, 1); assert.equal(auditRows('review.unhide', s.id).length, 1);
});

test('الجلسات: القائمة والأجهزة، وإنهاء الكل يُبطل التجديد ويحذف رموز الإشعارات، وإنهاء جلسة واحدة', async () => {
  const s = await c.student('96000061');
  const support = await c.staff('96000062', 'support');
  c.q.run("INSERT INTO device_tokens (user_id, platform, token) VALUES (?, 'android', 'ExponentPushToken[abcdef123456]')", s.id);
  const list = await c.api(`/api/admin/users/${s.id}/sessions`, { token: support.token });
  assert.equal(list.status, 200);
  assert.ok(list.json.sessions.length >= 1); assert.ok(SessionRow.safeParse(list.json.sessions[0]).success); assert.equal(list.json.sessions[0].revoked, false);
  assert.equal(list.json.devices.length, 1); assert.equal(list.json.devices[0].tokenSuffix, '23456]'); assert.equal(list.json.devices[0].platform, 'android');
  assert.equal((await post(support.token, `/api/admin/users/${s.id}/sessions/revoke`, {})).status, 204);
  assert.equal((await c.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: s.refreshToken } })).status, 401);
  assert.equal(c.q.val('SELECT COUNT(*) FROM device_tokens WHERE user_id = ?', s.id), 0);
  assert.equal(auditRows('user.force_logout', s.id).length, 1);
  // جلسة واحدة فقط: الأخرى تبقى
  const again = await c.login('96000061');
  const other = await c.login('96000061');
  const rows = c.q.all<any>('SELECT id FROM refresh_tokens WHERE user_id = ? AND revoked = 0 ORDER BY id', s.id);
  assert.equal(rows.length, 2);
  assert.equal((await post(support.token, `/api/admin/users/${s.id}/sessions/revoke`, { sessionId: rows[0].id, deviceTokens: false })).status, 204);
  assert.deepEqual(c.q.all<any>('SELECT id, revoked FROM refresh_tokens WHERE id IN (?, ?) ORDER BY id', rows[0].id, rows[1].id).map(x => x.revoked), [1, 0]);
  // الجلسة السليمة أولاً: تقديم رمز مُلغى يُنهي كل الجلسات (كشف إعادة الاستخدام في /auth/refresh)
  assert.equal((await c.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: other.refreshToken } })).status, 200, 'الجلسة الأخرى سليمة');
  assert.equal((await c.api('/api/auth/refresh', { method: 'POST', body: { refreshToken: again.refreshToken } })).status, 401);
});

test('تعديل البيانات: الاسم ينعكس على المتعلّم الذاتي، والهاتف/البريد المكرّر → 409', async () => {
  const s = await c.student('96000071');
  const other = await c.student('96000072');
  const admin = await c.staff('96000073', 'admin');
  const support = await c.staff('96000074', 'support');
  const path = `/api/admin/users/${s.id}/profile`;
  const patch = (token: string, body: unknown) => c.api(path, { method: 'PATCH', token, body });
  assert.equal((await patch(support.token, { displayName: 'اسم' })).status, 403);
  const r = await patch(admin.token, { displayName: 'اسم جديد', gender: 'male', timezone: 'Asia/Dubai' });
  assert.equal(r.status, 200); assert.equal(r.json.profile.displayName, 'اسم جديد'); assert.equal(r.json.profile.gender, 'male'); assert.equal(r.json.timezone, 'Asia/Dubai');
  assert.equal(r.json.learners[0].displayName, 'اسم جديد', 'المتعلّم الذاتي الأول يتبع اسم الحساب');
  const otherPhone = c.q.val<string>('SELECT phone FROM users WHERE id = ?', other.id)!;
  const dup = await patch(admin.token, { phone: otherPhone });
  assert.equal(dup.status, 409); assert.equal(dup.json.error.code, 'phone_taken');
  c.q.run('UPDATE users SET email = ? WHERE id = ?', 'other@example.com', other.id);
  const dupEmail = await patch(admin.token, { email: 'other@example.com' });
  assert.equal(dupEmail.status, 409); assert.equal(dupEmail.json.error.code, 'email_taken');
  assert.equal((await patch(admin.token, { email: 'new@example.com' })).json.email, 'new@example.com');
  assert.equal((await patch(admin.token, { phone: null, email: null })).status, 400, 'يبقى هاتف أو بريد');
  assert.equal((await patch(admin.token, { phone: '123' })).status, 422);
  const a = auditRows('user.profile_update', s.id);
  assert.ok(a.length >= 1); const meta = JSON.parse(a[0].meta); assert.equal(meta.before.displayName, `طالب 071`); assert.equal(meta.after.displayName, 'اسم جديد');
});

test('المتعلّمون من الإدارة: إضافة وتعديل وأرشفة وتفعيل عبر الخدمة نفسها، مسجَّلة بصاحب الحساب، ومتعلّم حساب آخر → 403', async () => {
  const s = await c.student('96000081');
  const stranger = await c.student('96000082');
  const support = await c.staff('96000083', 'support');
  const base = `/api/admin/users/${s.id}/learners`;
  const add = await post(support.token, base, { displayName: 'ابن الحساب', isSelf: false, gender: 'male', curriculumId: c.cat.curriculumId, gradeId: c.cat.grades[11], semesterId: c.cat.semesters[1], subjectIds: [c.cat.subjects.math] });
  assert.equal(add.status, 201); assert.equal(add.json.learners.length, 2);
  const child = add.json.learners.find((l: any) => !l.isSelf);
  assert.equal(child.displayName, 'ابن الحساب'); assert.equal(child.gradeId, c.cat.grades[11]); assert.deepEqual(child.subjectIds, [c.cat.subjects.math]);
  assert.ok(add.json.roles.some((r: any) => r.role === 'parent'), 'متعلّم غير ذاتي يمنح دور وليّ الأمر');
  const created = auditRows('learner.create', s.id); assert.equal(created.length, 1); assert.equal(created[0].actor_id, support.id); assert.equal(created[0].entity_id, child.id);
  const upd = await c.api(`${base}/${child.id}`, { method: 'PATCH', token: support.token, body: { displayName: 'ابن معدّل', subjectIds: [c.cat.subjects.math, c.cat.subjects.physics] } });
  assert.equal(upd.status, 200); const u = upd.json.learners.find((l: any) => l.id === child.id); assert.equal(u.displayName, 'ابن معدّل'); assert.deepEqual(u.subjectIds.sort(), [c.cat.subjects.math, c.cat.subjects.physics].sort());
  assert.equal(auditRows('learner.update', s.id).length, 1);
  const act = await post(support.token, `${base}/${child.id}/activate`);
  assert.equal(act.status, 200); assert.equal(act.json.activeLearnerId, child.id);
  assert.equal(auditRows('learner.activate', s.id).length, 1);
  const del = await c.api(`${base}/${child.id}`, { method: 'DELETE', token: support.token });
  assert.equal(del.status, 200); assert.equal(del.json.learners.length, 2, 'المؤرشف يبقى في بطاقة الشخص');
  assert.ok(del.json.learners.find((l: any) => l.id === child.id).archivedAt); assert.equal(del.json.activeLearnerId, s.learnerId, 'النشط يعود للافتراضي');
  assert.equal(auditRows('learner.archive', s.id).length, 1);
  const lastOne = await c.api(`${base}/${s.learnerId}`, { method: 'DELETE', token: support.token });
  assert.equal(lastOne.status, 409); assert.equal(lastOne.json.error.code, 'last_learner');
  const foreign = await c.api(`${base}/${stranger.learnerId}`, { method: 'PATCH', token: support.token, body: { displayName: 'اختراق' } });
  assert.equal(foreign.status, 403); assert.equal(foreign.json.error.code, 'learner_forbidden');
  assert.equal((await post(support.token, `${base}/${stranger.learnerId}/activate`)).status, 403);
  assert.equal((await post(support.token, '/api/admin/users/999999/learners', { displayName: 'x' })).status, 422);
  assert.equal((await post(support.token, '/api/admin/users/999999/learners', { displayName: 'ابن', curriculumId: c.cat.curriculumId, gradeId: c.cat.grades[11], semesterId: c.cat.semesters[1], subjectIds: [c.cat.subjects.math] })).status, 404);
  // سجلّ الشخص يُرشَّح بـ targetUserId ويحمل اسم المتأثّر
  const admin = await c.staff('96000084', 'admin');
  const log = await c.api(`/api/admin/audit?targetUserId=${s.id}&action=learner.`, { token: admin.token });
  assert.equal(log.status, 200); assert.equal(log.json.data.length, 4); assert.equal(log.json.meta.total, 4);
  assert.ok(log.json.data.every((a: any) => a.targetUserId === s.id && a.targetName === 'طالب 081' && a.action.startsWith('learner.')));
  const byActor = await c.api(`/api/admin/audit?actorId=${support.id}&entity=learners`, { token: admin.token });
  assert.equal(byActor.json.data.length, 4);
});

test('session_revoked يُبثّ لأجهزة المستخدم المتصلة عند الإيقاف وعند إنهاء الجلسات من الإدارة', async () => {
  const s = await c.student('96000091');
  const admin = await c.staff('96000092', 'admin');
  const { io } = await import('socket.io-client');
  const connect = () => new Promise<any>((resolve, reject) => {
    const sock = io(c.base, { auth: { token: s.token }, transports: ['websocket'], reconnection: false });
    sock.on('connect', () => resolve(sock)); sock.on('connect_error', reject);
  });
  const waitRevoked = (sock: any) => new Promise<any>((resolve, reject) => { sock.once('session_revoked', resolve); setTimeout(() => reject(new Error('لم يصل session_revoked')), 3000); });
  const s1 = await connect();
  const p1 = waitRevoked(s1);
  assert.equal((await post(admin.token, `/api/admin/users/${s.id}/sessions/revoke`, { deviceTokens: false })).status, 204);
  assert.deepEqual(await p1, { reason: 'force_logout' });
  const p2 = waitRevoked(s1);
  assert.equal((await post(admin.token, `/api/admin/users/${s.id}/status`, { status: 'suspended', reason: 'مخالفة' })).status, 200);
  assert.deepEqual(await p2, { reason: 'suspended' });
  s1.close();
});
