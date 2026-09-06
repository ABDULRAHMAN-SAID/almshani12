import { q, json, nowIso } from '../db/index.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { normalizeArabic } from '../lib/helpers.ts';

interface QuestionRow { id: number; type: 'mcq' | 'true_false' | 'short'; text: string; options: string; answer: string; explanation: string | null; topic_tag: string | null; points: number }

type Given = number[] | string;

/** التصحيح في الخادم فقط — الإجابات الصحيحة لا تُرسَل قبل التسليم */
export function scoreQuiz(quizId: number, userId: number, answers: Record<string, Given>, durationSeconds: number) {
  const quiz = q.get<any>('SELECT * FROM quizzes WHERE id = ?', quizId);
  if (!quiz) throw notFound('الاختبار غير موجود');
  const used = q.val<number>('SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?', quizId, userId) ?? 0;
  if (quiz.attempts_allowed > 0 && used >= quiz.attempts_allowed) throw new AppError('conflict', 'استنفدت المحاولات المسموحة', 409);

  const questions = q.all<QuestionRow>('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY "order", id', quizId);
  if (!questions.length) throw new AppError('content_unavailable', 'لا أسئلة في هذا الاختبار', 400);

  let score = 0;
  const maxScore = questions.reduce((s, qq) => s + qq.points, 0);
  const topics = new Map<string, { correct: number; total: number }>();

  const breakdown = questions.map(qq => {
    const given = answers[String(qq.id)];
    let correct = false;
    let expected: unknown;
    if (qq.type === 'short') {
      const accepted = json<string[]>(qq.answer, []).map(normalizeArabic);
      expected = accepted;
      correct = typeof given === 'string' && accepted.includes(normalizeArabic(given));
    } else {
      const want = [...json<number[]>(qq.answer, [])].sort((a, b) => a - b);
      expected = want;
      const got = Array.isArray(given) ? [...new Set(given.map(Number))].sort((a, b) => a - b) : [];
      correct = got.length === want.length && got.every((v, i) => v === want[i]);
    }
    if (correct) score += qq.points;
    const topic = qq.topic_tag || 'عام';
    const t = topics.get(topic) ?? { correct: 0, total: 0 };
    t.total += 1; if (correct) t.correct += 1;
    topics.set(topic, t);
    return { questionId: qq.id, correct, given: given ?? null, answer: expected, explanation: qq.explanation };
  });

  const percent = maxScore ? Math.round((score / maxScore) * 100) : 0;
  const passed = percent >= quiz.pass_score;
  const topicBreakdown = [...topics.entries()].map(([topic, t]) => ({ topic, percent: Math.round((t.correct / t.total) * 100), total: t.total }));

  const info = q.run(
    `INSERT INTO quiz_attempts (quiz_id, user_id, score, max_score, percent, passed, answers, topic_breakdown, duration_seconds, finished_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    quizId, userId, score, maxScore, percent, passed ? 1 : 0, JSON.stringify(answers), JSON.stringify(topicBreakdown), durationSeconds, nowIso());

  return { attemptId: Number(info.lastInsertRowid), score, maxScore, percent, passed, durationSeconds, breakdown, topics: topicBreakdown };
}

/** الاختبار للطالب — بلا إجابات صحيحة */
export function quizForStudent(quizId: number, userId: number) {
  const quiz = q.get<any>('SELECT * FROM quizzes WHERE id = ?', quizId);
  if (!quiz) throw notFound('الاختبار غير موجود');
  const questions = q.all<QuestionRow>('SELECT id, type, text, options, points, topic_tag FROM quiz_questions WHERE quiz_id = ? ORDER BY "order", id', quizId)
    .map(qq => ({ id: qq.id, type: qq.type, text: qq.text, options: json<string[]>(qq.options, []), points: qq.points, topicTag: qq.topic_tag }));
  const attemptsUsed = q.val<number>('SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?', quizId, userId) ?? 0;
  return { id: quiz.id, title: quiz.title, passScore: quiz.pass_score, timeLimitSeconds: quiz.time_limit_seconds, attemptsAllowed: quiz.attempts_allowed, attemptsUsed, questions };
}

/** «راجع نقاط ضعفك» عبر كل محاولات الطالب */
export function weakTopics(userId: number, limit = 6) {
  const rows = q.all<{ topic_breakdown: string; quiz_id: number }>('SELECT topic_breakdown, quiz_id FROM quiz_attempts WHERE user_id = ? ORDER BY id DESC LIMIT 50', userId);
  const agg = new Map<string, { sum: number; n: number }>();
  for (const r of rows) for (const t of json<{ topic: string; percent: number }[]>(r.topic_breakdown, [])) {
    const a = agg.get(t.topic) ?? { sum: 0, n: 0 }; a.sum += t.percent; a.n += 1; agg.set(t.topic, a);
  }
  return [...agg.entries()].map(([topic, a]) => ({ topic, percent: Math.round(a.sum / a.n) })).sort((a, b) => a.percent - b.percent).slice(0, limit);
}
