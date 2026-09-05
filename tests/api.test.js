/**
 * اختبارات تكامل للمسارات الحرجة: الصلاحيات، الشراء، الأرباح، والاسترجاع.
 * تُشغَّل على قاعدة بيانات مؤقتة: npm test
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'manassah-test-'));
process.env.DATA_DIR = TMP;
process.env.DB_FILE = path.join(TMP, 'test.db');
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.COMMISSION_RATE = '0.2';
process.env.REFERRAL_BONUS = '0';

const { app } = await import('../server/index.js');
const { q } = await import('../server/db/database.js');
const { checkAccess } = await import('../server/services/access.js');

let server, base;

before(async () => {
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const register = async (name, email, role = 'student') => {
  const res = await call('POST', '/api/auth/register', {
    body: { name, email, password: 'Passw0rd1', role },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
};

describe('المصادقة', () => {
  test('ينشئ حساباً ويرفض تكرار البريد', async () => {
    await register('طالب أ', 'a@test.om');
    const dup = await call('POST', '/api/auth/register', {
      body: { name: 'آخر', email: 'a@test.om', password: 'Passw0rd1' },
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'email_taken');
  });

  test('يرفض كلمة مرور ضعيفة', async () => {
    const res = await call('POST', '/api/auth/register', {
      body: { name: 'ضعيف', email: 'weak@test.om', password: '123' },
    });
    assert.equal(res.status, 422);
  });

  test('يرفض بيانات دخول خاطئة برسالة موحّدة', async () => {
    const res = await call('POST', '/api/auth/login', { body: { email: 'a@test.om', password: 'ghalat123' } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'invalid_credentials');
  });

  test('يجدّد الجلسة ويُبطل الرمز المستهلك', async () => {
    const auth = await register('مجدّد', 'refresh@test.om');
    const first = await call('POST', '/api/auth/refresh', { body: { refreshToken: auth.refreshToken } });
    assert.equal(first.status, 200);
    const replay = await call('POST', '/api/auth/refresh', { body: { refreshToken: auth.refreshToken } });
    assert.equal(replay.status, 401, 'الرمز المستهلك يجب أن يُرفض');
  });
});

describe('حماية المحتوى المدفوع', () => {
  let instructor, student, courseId, summaryId;

  before(async () => {
    instructor = await register('معلّم', 'teacher@test.om', 'instructor');
    q.run('UPDATE instructor_profiles SET approved = 1 WHERE user_id = ?', instructor.user.id);
    student = await register('طالب ب', 'b@test.om');

    const course = await call('POST', '/api/courses', {
      token: instructor.accessToken,
      body: { title: 'دورة اختبار', price: 10, level: 'beginner', type: 'recorded' },
    });
    courseId = course.body.id;
    await call('POST', `/api/courses/${courseId}/lessons`, {
      token: instructor.accessToken,
      body: { title: 'الدرس الأول', type: 'article', content_text: 'محتوى مدفوع', duration_seconds: 60 },
    });
    q.run("UPDATE courses SET status = 'published', published_at = datetime('now') WHERE id = ?", courseId);

    const summary = await call('POST', '/api/summaries', {
      token: instructor.accessToken,
      body: {
        title: 'ملخّص اختبار', book_title: 'كتاب', book_author: 'مؤلّف', price: 5,
        content: 'م'.repeat(300), preview_content: 'مقتطف',
      },
    });
    summaryId = summary.body.id;
    q.run("UPDATE summaries SET status = 'published', published_at = datetime('now') WHERE id = ?", summaryId);
  });

  test('لا يُسلّم محتوى الملخّص لغير المشتري', async () => {
    const res = await call('GET', `/api/summaries/${summaryId}`, { token: student.accessToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.summary.content, null, 'المحتوى الكامل يجب ألا يُرسَل');
    assert.equal(res.body.access.allowed, false);
  });

  test('يمنع القارئ بحالة 402 لغير المشتري', async () => {
    const res = await call('GET', `/api/summaries/${summaryId}/read`, { token: student.accessToken });
    assert.equal(res.status, 402);
  });

  test('يمنع التسجيل المجاني في دورة مدفوعة', async () => {
    const res = await call('POST', `/api/courses/${courseId}/enroll`, { token: student.accessToken });
    assert.equal(res.status, 402);
  });

  test('لا يُسلّم رابط درس مدفوع لغير المشترك', async () => {
    const lesson = q.get('SELECT id FROM lessons WHERE course_id = ?', courseId);
    const res = await call('GET', `/api/courses/${courseId}/lessons/${lesson.id}`, { token: student.accessToken });
    assert.equal(res.status, 402);
  });

  test('يمنع نشر دورة باسم معلّم آخر', async () => {
    const other = await register('معلّم ٢', 'teacher2@test.om', 'instructor');
    q.run('UPDATE instructor_profiles SET approved = 1 WHERE user_id = ?', other.user.id);
    const res = await call('PATCH', `/api/courses/${courseId}`, {
      token: other.accessToken, body: { title: 'اختطاف' },
    });
    assert.equal(res.status, 403);
  });
});

describe('الشراء والأرباح', () => {
  let instructor, buyer, summaryId;

  before(async () => {
    instructor = await register('بائع', 'seller@test.om', 'instructor');
    q.run('UPDATE instructor_profiles SET approved = 1 WHERE user_id = ?', instructor.user.id);
    buyer = await register('مشترٍ', 'buyer@test.om');

    const summary = await call('POST', '/api/summaries', {
      token: instructor.accessToken,
      body: {
        title: 'ملخّص للبيع', book_title: 'كتاب', book_author: 'مؤلّف', price: 10,
        content: 'م'.repeat(300), preview_content: 'مقتطف',
      },
    });
    summaryId = summary.body.id;
    q.run("UPDATE summaries SET status = 'published' WHERE id = ?", summaryId);
    // شحن المحفظة للدفع الفوري
    q.run('UPDATE users SET wallet_balance = 100 WHERE id = ?', buyer.user.id);
  });

  test('يتم الشراء ويُمنح الوصول وتُقيَّد حصّة المعلّم', async () => {
    const res = await call('POST', '/api/checkout', {
      token: buyer.accessToken,
      body: { items: [{ item_type: 'summary', item_id: summaryId }], provider: 'wallet' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.paid, true);
    assert.equal(res.body.order.total, 10);

    const access = checkAccess(buyer.user.id, 'summary', summaryId);
    assert.equal(access.allowed, true);
    assert.equal(access.reason, 'purchase');

    // ٨٠٪ للمعلّم بعد عمولة ٢٠٪
    const profile = q.get('SELECT balance FROM instructor_profiles WHERE user_id = ?', instructor.user.id);
    assert.equal(profile.balance, 8);

    const wallet = q.val('SELECT wallet_balance FROM users WHERE id = ?', buyer.user.id);
    assert.equal(wallet, 90);
  });

  test('يُسلّم المحتوى الكامل بعد الشراء', async () => {
    const res = await call('GET', `/api/summaries/${summaryId}/read`, { token: buyer.accessToken });
    assert.equal(res.status, 200);
    assert.ok(res.body.content.length > 100);
  });

  test('يمنع شراء نفس العنصر مرتين', async () => {
    const res = await call('POST', '/api/checkout', {
      token: buyer.accessToken,
      body: { items: [{ item_type: 'summary', item_id: summaryId }], provider: 'wallet' },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'already_owned');
  });

  test('يرفض الدفع عند نقص الرصيد', async () => {
    const poor = await register('بلا رصيد', 'poor@test.om');
    const other = await call('POST', '/api/summaries', {
      token: instructor.accessToken,
      body: { title: 'غالٍ', book_title: 'كتاب', book_author: 'مؤلف', price: 999,
              content: 'م'.repeat(300), preview_content: 'مقتطف' },
    });
    q.run("UPDATE summaries SET status = 'published' WHERE id = ?", other.body.id);

    const res = await call('POST', '/api/checkout', {
      token: poor.accessToken,
      body: { items: [{ item_type: 'summary', item_id: other.body.id }], provider: 'wallet' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'insufficient_funds');
    assert.equal(checkAccess(poor.user.id, 'summary', other.body.id).allowed, false);
  });

  test('الاسترجاع يسحب الوصول ويعيد المبلغ', async () => {
    const admin = await register('مدير', 'admin@test.om');
    q.run("UPDATE users SET role = 'admin' WHERE id = ?", admin.user.id);
    const order = q.get("SELECT id FROM orders WHERE user_id = ? AND status = 'paid' ORDER BY id LIMIT 1", buyer.user.id);

    const res = await call('POST', `/api/admin/orders/${order.id}/refund`, {
      token: admin.accessToken, body: { reason: 'اختبار', toWallet: true },
    });
    assert.equal(res.status, 200);
    assert.equal(checkAccess(buyer.user.id, 'summary', summaryId).allowed, false, 'يجب سحب الوصول');
    assert.equal(q.val('SELECT wallet_balance FROM users WHERE id = ?', buyer.user.id), 100);
  });
});

describe('الكوبونات والفوترة', () => {
  test('يطبّق نسبة الخصم ويرفض الرمز المنتهي', async () => {
    const instructor = await register('صاحب كوبون', 'coupon@test.om', 'instructor');
    q.run('UPDATE instructor_profiles SET approved = 1 WHERE user_id = ?', instructor.user.id);
    const student = await register('مستخدم كوبون', 'couponuser@test.om');

    const summary = await call('POST', '/api/summaries', {
      token: instructor.accessToken,
      body: { title: 'بخصم', book_title: 'كتاب', book_author: 'مؤلف', price: 20,
              content: 'م'.repeat(300), preview_content: 'مقتطف' },
    });
    q.run("UPDATE summaries SET status = 'published' WHERE id = ?", summary.body.id);

    await call('POST', '/api/coupons', {
      token: instructor.accessToken,
      body: { code: 'HALF', type: 'percent', value: 50 },
    });

    const quote = await call('POST', '/api/quote', {
      token: student.accessToken,
      body: { items: [{ item_type: 'summary', item_id: summary.body.id }], coupon: 'HALF' },
    });
    assert.equal(quote.body.subtotal, 20);
    assert.equal(quote.body.discount, 10);
    assert.equal(quote.body.total, 10);

    q.run("UPDATE coupons SET expires_at = '2000-01-01' WHERE code = 'HALF'");
    const expired = await call('POST', '/api/quote', {
      token: student.accessToken,
      body: { items: [{ item_type: 'summary', item_id: summary.body.id }], coupon: 'HALF' },
    });
    assert.equal(expired.status, 400);
    assert.equal(expired.body.error.code, 'coupon_expired');
  });
});

describe('الحصص المباشرة', () => {
  test('يمنع الحجز فوق السعة ويخفي رابط الاجتماع', async () => {
    const instructor = await register('معلّم حصص', 'live@test.om', 'instructor');
    q.run('UPDATE instructor_profiles SET approved = 1 WHERE user_id = ?', instructor.user.id);

    const created = await call('POST', '/api/live', {
      token: instructor.accessToken,
      body: {
        title: 'حصة اختبار', starts_at: new Date(Date.now() + 864e5).toISOString(),
        capacity: 1, price: 0, duration_minutes: 60, meeting_provider: 'internal',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const sessionId = created.body.id;

    const first = await register('حاجز ١', 'book1@test.om');
    const second = await register('حاجز ٢', 'book2@test.om');

    assert.equal((await call('POST', `/api/live/${sessionId}/book`, { token: first.accessToken })).status, 200);
    const full = await call('POST', `/api/live/${sessionId}/book`, { token: second.accessToken });
    assert.equal(full.status, 409);
    assert.equal(full.body.error.code, 'session_full');

    // غير الحاجز لا يرى رمز القاعة
    const peek = await call('GET', `/api/live/${sessionId}`, { token: second.accessToken });
    assert.equal(peek.body.session.room_code, null);
  });

  test('يرفض جدولة حصة في الماضي', async () => {
    const instructor = await register('معلّم تاريخ', 'past@test.om', 'instructor');
    q.run('UPDATE instructor_profiles SET approved = 1 WHERE user_id = ?', instructor.user.id);
    const res = await call('POST', '/api/live', {
      token: instructor.accessToken,
      body: { title: 'ماضية', starts_at: new Date(Date.now() - 864e5).toISOString(), capacity: 5, price: 0 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'past_date');
  });
});

describe('الاختبارات والشهادات', () => {
  test('لا تُرسَل الإجابات الصحيحة قبل التسليم، وتُحتسب الدرجة بدقّة', async () => {
    const instructor = await register('معلّم اختبار', 'quiz@test.om', 'instructor');
    q.run('UPDATE instructor_profiles SET approved = 1 WHERE user_id = ?', instructor.user.id);
    const student = await register('ممتحَن', 'quizstudent@test.om');

    const course = await call('POST', '/api/courses', {
      token: instructor.accessToken, body: { title: 'دورة مجانية', price: 0 },
    });
    q.run("UPDATE courses SET status = 'published' WHERE id = ?", course.body.id);

    const quiz = await call('POST', '/api/quizzes', {
      token: instructor.accessToken,
      body: {
        course_id: course.body.id, title: 'امتحان', pass_score: 50, attempts_allowed: 3,
        questions: [
          { text: 'س١', options: ['أ', 'ب'], correct: [0], points: 1 },
          { text: 'س٢', options: ['ج', 'د'], correct: [1], points: 1 },
        ],
      },
    });
    assert.equal(quiz.status, 201, JSON.stringify(quiz.body));

    const fetched = await call('GET', `/api/quizzes/${quiz.body.id}`, { token: student.accessToken });
    assert.equal(fetched.status, 200);
    assert.ok(fetched.body.questions.every(q2 => q2.correct === undefined), 'لا تُكشف الإجابات الصحيحة');

    const ids = fetched.body.questions.map(q2 => q2.id);
    const submitted = await call('POST', `/api/quizzes/${quiz.body.id}/submit`, {
      token: student.accessToken,
      body: { answers: { [ids[0]]: [0], [ids[1]]: [0] } },
    });
    assert.equal(submitted.body.score, 1);
    assert.equal(submitted.body.percent, 50);
    assert.equal(submitted.body.passed, true);
  });

  test('يمنع الشهادة قبل إكمال الدورة', async () => {
    const instructor = await register('معلّم شهادة', 'cert@test.om', 'instructor');
    q.run('UPDATE instructor_profiles SET approved = 1 WHERE user_id = ?', instructor.user.id);
    const student = await register('طالب شهادة', 'certstudent@test.om');

    const course = await call('POST', '/api/courses', {
      token: instructor.accessToken, body: { title: 'دورة شهادة', price: 0 },
    });
    q.run("UPDATE courses SET status = 'published' WHERE id = ?", course.body.id);
    await call('POST', `/api/courses/${course.body.id}/lessons`, {
      token: instructor.accessToken, body: { title: 'درس', type: 'article', content_text: 'نص' },
    });
    await call('POST', `/api/courses/${course.body.id}/enroll`, { token: student.accessToken });

    const early = await call('POST', `/api/certificates/${course.body.id}/issue`, { token: student.accessToken });
    assert.equal(early.status, 400);
    assert.equal(early.body.error.code, 'course_incomplete');

    const lesson = q.get('SELECT id FROM lessons WHERE course_id = ?', course.body.id);
    await call('POST', `/api/courses/${course.body.id}/lessons/${lesson.id}/progress`, {
      token: student.accessToken, body: { completed: true },
    });
    const issued = await call('POST', `/api/certificates/${course.body.id}/issue`, { token: student.accessToken });
    assert.equal(issued.status, 201);

    const verified = await call('GET', `/api/certificates/verify/${issued.body.certificate.serial}`);
    assert.equal(verified.body.valid, true);
    assert.equal(verified.body.certificate.course_title, 'دورة شهادة');
  });
});

describe('صلاحيات الإدارة', () => {
  test('يمنع غير المدير من الوصول للوحة الإدارة', async () => {
    const student = await register('فضولي', 'nosy@test.om');
    const res = await call('GET', '/api/admin/overview', { token: student.accessToken });
    assert.equal(res.status, 403);
  });

  test('يمنع المستخدم من رفع نفسه لمدير', async () => {
    const student = await register('طموح', 'ambitious@test.om');
    const res = await call('PATCH', `/api/admin/users/${student.user.id}`, {
      token: student.accessToken, body: { role: 'admin' },
    });
    assert.equal(res.status, 403);
    assert.equal(q.val('SELECT role FROM users WHERE id = ?', student.user.id), 'student');
  });
});

describe('التقييمات', () => {
  test('يمنع التقييم ممّن لم يشترِ', async () => {
    const instructor = await register('معلّم تقييم', 'review@test.om', 'instructor');
    q.run('UPDATE instructor_profiles SET approved = 1 WHERE user_id = ?', instructor.user.id);
    const stranger = await register('غريب', 'stranger@test.om');

    const course = await call('POST', '/api/courses', {
      token: instructor.accessToken, body: { title: 'دورة تقييم', price: 15 },
    });
    q.run("UPDATE courses SET status = 'published' WHERE id = ?", course.body.id);

    const res = await call('POST', '/api/reviews', {
      token: stranger.accessToken,
      body: { item_type: 'course', item_id: course.body.id, rating: 5, comment: 'ممتاز' },
    });
    assert.equal(res.status, 403);
  });
});
