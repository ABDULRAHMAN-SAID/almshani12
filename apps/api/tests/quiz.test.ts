import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

function makeQuiz(authorId: number, ownerType = 'standalone', ownerId: number | null = null, attempts = 3) {
  const id = Number(c.q.run('INSERT INTO quizzes (owner_type, owner_id, author_id, title, pass_score, attempts_allowed) VALUES (?,?,?,?,60,?)', ownerType, ownerId, authorId, 'اختبار', attempts).lastInsertRowid);
  const add = (type: string, text: string, options: string[], answer: unknown, topic: string, points = 1) =>
    c.q.run('INSERT INTO quiz_questions (quiz_id, type, text, options, answer, topic_tag, points) VALUES (?,?,?,?,?,?,?)', id, type, text, JSON.stringify(options), JSON.stringify(answer), topic, points);
  add('mcq', 'س١', ['أ', 'ب', 'ج'], [1], 'الحركة');
  add('mcq', 'س٢ (إجابتان)', ['أ', 'ب', 'ج', 'د'], [0, 2], 'الحركة', 2);
  add('true_false', 'س٣', ['صح', 'خطأ'], [0], 'القوى');
  add('short', 'س٤', [], ['الإزاحة', 'إزاحة'], 'القوى');
  return id;
}

test('التصحيح في الخادم: أنواع الأسئلة، التطبيع العربي، توزيع الدرجات بالموضوع', async () => {
  const t = await c.teacher('97000001');
  const s = await c.student('97000002');
  const quizId = makeQuiz(t.id);
  const get = await c.api(`/api/courses/quizzes/${quizId}`, { token: s.token });
  assert.equal(get.status, 200);
  assert.equal(get.json.questions.length, 4);
  assert.ok(!JSON.stringify(get.json).includes('"answer"'), 'لا مفتاح إجابات قبل التسليم');
  const ids = get.json.questions.map((x: any) => x.id);
  const submit = await c.api(`/api/courses/quizzes/${quizId}/submit`, { method: 'POST', token: s.token, body: { durationSeconds: 60, answers: { [ids[0]]: [1], [ids[1]]: [2, 0], [ids[2]]: [1], [ids[3]]: 'الازاحه' } } });
  assert.equal(submit.status, 200);
  assert.equal(submit.json.maxScore, 5);
  assert.equal(submit.json.score, 4, 'س٢ بترتيب مختلف صحيحة، س٤ بهمزة/تاء مختلفة صحيحة، س٣ خطأ');
  assert.equal(submit.json.percent, 80); assert.equal(submit.json.passed, true);
  const topics = Object.fromEntries(submit.json.topics.map((x: any) => [x.topic, x.percent]));
  assert.equal(topics['الحركة'], 100); assert.equal(topics['القوى'], 50);
  assert.equal(submit.json.breakdown[2].correct, false);
  assert.deepEqual(submit.json.breakdown[2].answer, [0], 'الإجابة الصحيحة تظهر بعد التسليم');
  // إجابة جزئية لسؤال متعدّد الإجابات لا تُحتسب
  const partial = await c.api(`/api/courses/quizzes/${quizId}/submit`, { method: 'POST', token: s.token, body: { durationSeconds: 10, answers: { [ids[1]]: [0] } } });
  assert.equal(partial.json.score, 0);
  // نقاط الضعف من كل المحاولات
  const progress = await c.api('/api/me/progress', { token: s.token });
  assert.equal(progress.json.week.quizzes, 2);
  assert.ok(progress.json.weakTopics.length > 0);
});

test('حدّ المحاولات واختبار داخل محتوى مدفوع', async () => {
  const t = await c.teacher('97000011');
  const s = await c.student('97000012');
  const one = makeQuiz(t.id, 'standalone', null, 1);
  await c.api(`/api/courses/quizzes/${one}/submit`, { method: 'POST', token: s.token, body: { durationSeconds: 1, answers: {} } });
  const second = await c.api(`/api/courses/quizzes/${one}/submit`, { method: 'POST', token: s.token, body: { durationSeconds: 1, answers: {} } });
  assert.equal(second.status, 409);
  const course = c.course(t.id, { price: 5 });
  const locked = makeQuiz(t.id, 'course', course.id);
  assert.equal((await c.api(`/api/courses/quizzes/${locked}`, { token: s.token })).status, 402);
  assert.equal((await c.api(`/api/courses/quizzes/${locked}/submit`, { method: 'POST', token: s.token, body: { durationSeconds: 1, answers: {} } })).status, 402);
});
