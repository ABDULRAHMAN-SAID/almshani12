import { Server } from 'socket.io';
import { q } from '../db/database.js';
import { verifyAccessToken } from '../middleware/auth.js';
import { checkAccess } from '../services/access.js';
import { bindIo } from '../services/notifications.js';
import { json, nowIso } from '../utils/helpers.js';

/** حالة القاعات في الذاكرة: من متصل، ومن رفع يده، وحالة الاختبار المباشر. */
const rooms = new Map();

const roomState = (sessionId) => {
  if (!rooms.has(sessionId)) {
    rooms.set(sessionId, { participants: new Map(), hands: new Set(), quiz: null });
  }
  return rooms.get(sessionId);
};

const presenceList = (state) =>
  [...state.participants.values()].map(p => ({ ...p, handRaised: state.hands.has(p.id) }));

export function setupRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1e6,
  });
  bindIo(io);

  // المصادقة قبل أي حدث
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const payload = token ? verifyAccessToken(token) : null;
    if (!payload) return next(new Error('unauthorized'));
    const user = q.get('SELECT id, name, avatar, role FROM users WHERE id = ? AND status = ?', payload.sub, 'active');
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    // قناة خاصة لإشعارات المستخدم
    socket.join(`user:${socket.user.id}`);

    /* ------------------- الدخول إلى قاعة حصة ------------------- */
    socket.on('live:join', ({ sessionId }, ack) => {
      const id = Number(sessionId);
      const session = q.get('SELECT * FROM live_sessions WHERE id = ?', id);
      if (!session) return ack?.({ error: 'الحصة غير موجودة' });

      const isHost = session.instructor_id === socket.user.id || socket.user.role === 'admin';
      const access = checkAccess(socket.user.id, 'live_session', id, { user: socket.user });
      if (!isHost && !access.allowed) return ack?.({ error: 'يجب حجز مقعد للدخول' });

      socket.join(`live:${id}`);
      socket.data.sessionId = id;
      socket.data.isHost = isHost;
      socket.data.joinedAt = Date.now();

      const state = roomState(id);
      state.participants.set(socket.user.id, {
        id: socket.user.id, name: socket.user.name, avatar: socket.user.avatar, isHost,
      });

      if (!isHost) {
        q.run("UPDATE live_bookings SET joined_at = COALESCE(joined_at, ?), status = 'attended' WHERE session_id = ? AND user_id = ?",
          nowIso(), id, socket.user.id);
      }

      io.to(`live:${id}`).emit('live:presence', { participants: presenceList(state) });
      socket.to(`live:${id}`).emit('live:system', { message: `انضم ${socket.user.name}`, at: nowIso() });

      ack?.({
        ok: true, isHost, sessionStatus: session.status,
        participants: presenceList(state),
        quiz: state.quiz ? publicQuizState(state.quiz) : null,
      });
    });

    /* ------------------- الدردشة ------------------- */
    socket.on('live:message', ({ body, kind = 'chat' }, ack) => {
      const id = socket.data.sessionId;
      if (!id) return ack?.({ error: 'لست داخل قاعة' });
      const text = String(body || '').trim().slice(0, 1000);
      if (!text) return ack?.({ error: 'الرسالة فارغة' });

      const info = q.run('INSERT INTO live_messages (session_id, user_id, body, kind) VALUES (?,?,?,?)',
        id, socket.user.id, text, ['chat', 'question'].includes(kind) ? kind : 'chat');
      const message = {
        id: info.lastInsertRowid, session_id: id, user_id: socket.user.id,
        user_name: socket.user.name, user_avatar: socket.user.avatar,
        body: text, kind, created_at: nowIso(), isHost: !!socket.data.isHost,
      };
      io.to(`live:${id}`).emit('live:message', message);
      ack?.({ ok: true, message });
    });

    /* ------------------- رفع اليد ------------------- */
    socket.on('live:hand', ({ raised }) => {
      const id = socket.data.sessionId;
      if (!id) return;
      const state = roomState(id);
      if (raised) state.hands.add(socket.user.id); else state.hands.delete(socket.user.id);
      io.to(`live:${id}`).emit('live:presence', { participants: presenceList(state) });
    });

    /* ------------------- بثّ الشرائح/الرابط من المضيف ------------------- */
    socket.on('live:broadcast', (payload) => {
      const id = socket.data.sessionId;
      if (!id || !socket.data.isHost) return;
      socket.to(`live:${id}`).emit('live:broadcast', { ...payload, at: nowIso() });
    });

    /* ================= الاختبار التفاعلي المباشر ================= */
    socket.on('quiz:start', ({ quizId }, ack) => {
      const id = socket.data.sessionId;
      if (!id || !socket.data.isHost) return ack?.({ error: 'المضيف فقط يبدأ الاختبار' });

      const quiz = q.get('SELECT * FROM quizzes WHERE id = ?', Number(quizId));
      if (!quiz) return ack?.({ error: 'الاختبار غير موجود' });
      const questions = q.all('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position, id', quiz.id);
      if (!questions.length) return ack?.({ error: 'لا توجد أسئلة' });

      const state = roomState(id);
      state.quiz = {
        quizId: quiz.id, title: quiz.title, questions,
        index: -1, scores: new Map(), answers: new Map(), questionStartedAt: null,
      };
      io.to(`live:${id}`).emit('quiz:ready', { title: quiz.title, total: questions.length });
      ack?.({ ok: true, total: questions.length });
    });

    socket.on('quiz:next', (_payload, ack) => {
      const id = socket.data.sessionId;
      const state = id ? roomState(id) : null;
      if (!id || !socket.data.isHost || !state?.quiz) return ack?.({ error: 'لا يوجد اختبار نشط' });

      const quiz = state.quiz;
      quiz.index += 1;
      if (quiz.index >= quiz.questions.length) {
        const leaderboard = finalLeaderboard(quiz);
        persistLiveScores(quiz, leaderboard);
        io.to(`live:${id}`).emit('quiz:finished', { leaderboard });
        state.quiz = null;
        return ack?.({ ok: true, finished: true, leaderboard });
      }

      const question = quiz.questions[quiz.index];
      quiz.answers = new Map();
      quiz.questionStartedAt = Date.now();

      // الإجابات الصحيحة لا تغادر الخادم قبل انتهاء السؤال
      io.to(`live:${id}`).emit('quiz:question', {
        index: quiz.index, total: quiz.questions.length,
        text: question.text, options: json(question.options, []),
        type: question.type, seconds: question.time_seconds,
      });
      ack?.({ ok: true, index: quiz.index });
    });

    socket.on('quiz:answer', ({ choices }, ack) => {
      const id = socket.data.sessionId;
      const state = id ? roomState(id) : null;
      if (!state?.quiz || state.quiz.index < 0) return ack?.({ error: 'لا يوجد سؤال نشط' });
      const quiz = state.quiz;
      if (quiz.answers.has(socket.user.id)) return ack?.({ error: 'أجبت على هذا السؤال' });

      const question = quiz.questions[quiz.index];
      const elapsed = (Date.now() - quiz.questionStartedAt) / 1000;
      if (elapsed > question.time_seconds + 2) return ack?.({ error: 'انتهى وقت السؤال' });

      const given = [...new Set((choices || []).map(Number))].sort((a, b) => a - b);
      const correct = [...json(question.correct, [])].sort((a, b) => a - b);
      const isCorrect = given.length === correct.length && given.every((v, i) => v === correct[i]);

      // نقاط السرعة: الإجابة الأسرع تُكافأ، بحد أدنى نصف النقاط
      const speedFactor = Math.max(0.5, 1 - elapsed / (question.time_seconds * 2));
      const points = isCorrect ? Math.round(question.points * 100 * speedFactor) : 0;

      quiz.answers.set(socket.user.id, { given, isCorrect, points });
      quiz.scores.set(socket.user.id, {
        name: socket.user.name,
        score: (quiz.scores.get(socket.user.id)?.score || 0) + points,
        correct: (quiz.scores.get(socket.user.id)?.correct || 0) + (isCorrect ? 1 : 0),
      });

      io.to(`live:${id}`).emit('quiz:answered', { answered: quiz.answers.size, total: state.participants.size });
      ack?.({ ok: true, submitted: true });
    });

    socket.on('quiz:reveal', (_payload, ack) => {
      const id = socket.data.sessionId;
      const state = id ? roomState(id) : null;
      if (!id || !socket.data.isHost || !state?.quiz) return ack?.({ error: 'لا يوجد اختبار نشط' });

      const quiz = state.quiz;
      const question = quiz.questions[quiz.index];
      const options = json(question.options, []);
      const distribution = options.map((_, i) =>
        [...quiz.answers.values()].filter(a => a.given.includes(i)).length);

      io.to(`live:${id}`).emit('quiz:reveal', {
        correct: json(question.correct, []),
        explanation: question.explanation,
        distribution,
        leaderboard: topScores(quiz, 5),
      });
      // كل مشارك يرى نتيجته الشخصية
      for (const [userId, answer] of quiz.answers) {
        io.to(`user:${userId}`).emit('quiz:my-result', {
          isCorrect: answer.isCorrect, points: answer.points, total: quiz.scores.get(userId)?.score || 0,
        });
      }
      ack?.({ ok: true });
    });

    /* ------------------- الخروج ------------------- */
    socket.on('disconnect', () => {
      const id = socket.data.sessionId;
      if (!id) return;
      const state = roomState(id);
      state.participants.delete(socket.user.id);
      state.hands.delete(socket.user.id);

      if (!socket.data.isHost && socket.data.joinedAt) {
        const minutes = Math.round((Date.now() - socket.data.joinedAt) / 60000);
        q.run('UPDATE live_bookings SET left_at = ?, attendance_minutes = attendance_minutes + ? WHERE session_id = ? AND user_id = ?',
          nowIso(), minutes, id, socket.user.id);
      }
      io.to(`live:${id}`).emit('live:presence', { participants: presenceList(state) });
      if (state.participants.size === 0) rooms.delete(id);
    });
  });

  return io;
}

const topScores = (quiz, limit) =>
  [...quiz.scores.entries()]
    .map(([id, s]) => ({ userId: id, ...s }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

const finalLeaderboard = (quiz) => topScores(quiz, 20);
const publicQuizState = (quiz) => ({ title: quiz.title, index: quiz.index, total: quiz.questions.length });

/** يحفظ نتائج الاختبار المباشر كمحاولات حتى تظهر في سجلّ الطالب. */
function persistLiveScores(quiz, leaderboard) {
  const maxScore = quiz.questions.reduce((s, question) => s + question.points, 0);
  for (const entry of leaderboard) {
    const percent = quiz.questions.length ? Math.round((entry.correct / quiz.questions.length) * 100) : 0;
    q.run(
      `INSERT INTO quiz_attempts (quiz_id, user_id, score, max_score, percent, passed, answers, finished_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      quiz.quizId, entry.userId, entry.correct, maxScore, percent, percent >= 60 ? 1 : 0,
      JSON.stringify({ live: true, points: entry.score }), nowIso());
  }
}
