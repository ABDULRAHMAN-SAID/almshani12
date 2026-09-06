import { api } from '../api.js';
import { esc, spinner, toast, duration, markdown, emptyState, errorState, fromNow, avatar, modal, section } from '../ui.js';
import { navigate } from '../router.js';
import { state } from '../store.js';

/* ============================ مشغّل الدروس ============================ */
export async function learn({ view, params }) {
  view.innerHTML = spinner('نفتح فصلك الدراسي...');

  let data;
  try { data = await api.get(`/courses/${params.courseId}`); }
  catch (err) { view.innerHTML = errorState(err.message, '#/courses'); return; }

  const { course, curriculum, access } = data;
  if (!access.allowed) {
    view.innerHTML = emptyState('🔒', 'هذه الدورة غير متاحة لك بعد',
      'اشترك في الدورة للوصول إلى كل الدروس.',
      `<a href="#/courses/${esc(course.slug)}" class="btn btn-primary">صفحة الدورة</a>`);
    return;
  }

  const allLessons = curriculum.flatMap(s => s.lessons);
  if (!allLessons.length) {
    view.innerHTML = emptyState('📭', 'لا توجد دروس بعد', 'سيضيف المعلّم المحتوى قريباً.');
    return;
  }

  let currentId = Number(params.lessonId) || data.progress?.last_lesson_id || allLessons[0].id;
  if (!allLessons.some(l => l.id === currentId)) currentId = allLessons[0].id;

  let progressMap = new Map();
  let saveTimer = null;

  const renderShell = () => {
    view.innerHTML = `
      <div class="bg-slate-900 text-white sticky top-16 z-30 no-print">
        <div class="max-w-[1600px] mx-auto px-4 h-14 flex items-center gap-3">
          <a href="#/courses/${esc(course.slug)}" class="text-slate-300 hover:text-white text-sm shrink-0">← الدورة</a>
          <h1 class="font-bold truncate flex-1 text-sm md:text-base">${esc(course.title)}</h1>
          <div class="hidden sm:flex items-center gap-2 text-xs">
            <div class="w-24 progress bg-slate-700"><div id="topProgress" style="width:0%"></div></div>
            <span id="progressLabel" class="tabular-nums">0٪</span>
          </div>
          <button id="sidebarToggle" class="lg:hidden btn btn-sm bg-white/10 text-white">📋</button>
        </div>
      </div>
      <div class="max-w-[1600px] mx-auto grid lg:grid-cols-[1fr_340px] gap-0">
        <div id="lessonPane" class="min-h-[60vh] bg-white"></div>
        <aside id="sidebar" class="hidden lg:block border-r border-slate-200 bg-slate-50 max-h-[calc(100vh-7.5rem)] overflow-auto lg:sticky lg:top-[7.5rem]"></aside>
      </div>`;

    document.getElementById('sidebarToggle').addEventListener('click', () =>
      document.getElementById('sidebar').classList.toggle('hidden'));
  };

  const renderSidebar = () => {
    const done = [...progressMap.values()].filter(p => p.completed).length;
    const percent = Math.round((done / allLessons.length) * 100);
    document.getElementById('topProgress').style.width = `${percent}%`;
    document.getElementById('progressLabel').textContent = `${percent}٪`;

    document.getElementById('sidebar').innerHTML = `
      <div class="p-4 border-b bg-white">
        <p class="text-sm font-bold">تقدّمك في الدورة</p>
        <div class="progress mt-2"><div style="width:${percent}%"></div></div>
        <p class="text-xs text-slate-500 mt-1">${done} من ${allLessons.length} درس</p>
        ${percent >= 100 ? '<button id="certBtn" class="btn btn-amber btn-sm w-full mt-3">🎓 استخرج شهادتك</button>' : ''}
      </div>
      ${curriculum.map(sec => `
        <div>
          <div class="px-4 py-2.5 bg-slate-100 font-bold text-xs text-slate-600">${esc(sec.title)}</div>
          ${sec.lessons.map(lesson => {
            const isDone = progressMap.get(lesson.id)?.completed;
            const isCurrent = lesson.id === currentId;
            const icon = { video: '▶️', article: '📄', pdf: '📕', quiz: '📝', live: '🔴', audio: '🎧' }[lesson.type] || '📄';
            return `
              <button data-goto="${lesson.id}" class="w-full text-right flex items-start gap-2.5 px-4 py-3 border-b border-slate-200/70 text-sm transition-colors
                      ${isCurrent ? 'bg-brand-50 border-r-4 border-r-brand-600' : 'hover:bg-white'}">
                <span class="mt-0.5">${isDone ? '✅' : icon}</span>
                <span class="flex-1 ${isCurrent ? 'font-bold text-brand-800' : 'text-slate-700'}">${esc(lesson.title)}</span>
                ${lesson.duration_seconds ? `<span class="text-[11px] text-slate-400 tabular-nums mt-0.5">${duration(lesson.duration_seconds)}</span>` : ''}
              </button>`;
          }).join('')}
        </div>`).join('')}
      <div class="p-4"><a href="#/notes" class="btn btn-ghost btn-sm w-full">📝 كل ملاحظاتي</a></div>`;

    document.getElementById('sidebar').querySelectorAll('[data-goto]').forEach(btn =>
      btn.addEventListener('click', () => { currentId = Number(btn.dataset.goto); openLesson(); }));

    document.getElementById('certBtn')?.addEventListener('click', async () => {
      try {
        const result = await api.post(`/certificates/${course.id}/issue`);
        toast(result.existing ? 'شهادتك جاهزة' : 'مبروك! صدرت شهادتك 🎓', 'success');
        navigate('/certificates');
      } catch (err) { toast(err.message, 'error'); }
    });
  };

  const lessonBody = (lesson) => {
    if (lesson.type === 'video' && lesson.content_url) {
      return `<video id="player" controls playsinline class="w-full aspect-video bg-black rounded-xl"
                     src="${esc(lesson.content_url)}"></video>
              <p class="text-xs text-slate-400 mt-2">إن لم يعمل الفيديو فقد يكون الرابط تجريبياً في بيانات العرض.</p>`;
    }
    if (lesson.type === 'audio' && lesson.content_url) {
      return `<audio id="player" controls class="w-full" src="${esc(lesson.content_url)}"></audio>`;
    }
    if (lesson.type === 'pdf' && lesson.content_url) {
      return `<iframe src="${esc(lesson.content_url)}" class="w-full h-[70vh] rounded-xl border"></iframe>`;
    }
    if (lesson.content_text) return `<div class="prose-ar">${markdown(lesson.content_text)}</div>`;
    return `<div class="bg-slate-50 rounded-xl p-8 text-center text-slate-500">لا يوجد محتوى مرفوع لهذا الدرس بعد.</div>`;
  };

  const openLesson = async () => {
    history.replaceState(null, '', `#/learn/${course.id}/${currentId}`);
    const pane = document.getElementById('lessonPane');
    pane.innerHTML = spinner();

    let payload;
    try { payload = await api.get(`/courses/${course.id}/lessons/${currentId}`); }
    catch (err) { pane.innerHTML = errorState(err.message); return; }

    const { lesson, quiz, notes, nextLesson } = payload;
    const isDone = progressMap.get(lesson.id)?.completed;

    pane.innerHTML = `
      <div class="p-4 md:p-6 max-w-4xl mx-auto">
        <h2 class="text-2xl font-extrabold font-display mb-4">${esc(lesson.title)}</h2>
        <div class="mb-6">${lessonBody(lesson)}</div>

        <div class="flex flex-wrap gap-2 mb-8">
          <button id="completeBtn" class="btn ${isDone ? 'btn-ghost' : 'btn-primary'}">
            ${isDone ? '✅ مكتمل — إلغاء' : '✓ وضع علامة مكتمل'}
          </button>
          ${quiz ? `<a href="#/quiz/${quiz.id}" class="btn btn-amber">📝 اختبار الدرس</a>` : ''}
          ${nextLesson ? `<button id="nextBtn" class="btn btn-ghost">الدرس التالي: ${esc(nextLesson.title)} ←</button>` : ''}
        </div>

        <!-- الملاحظات -->
        <div class="card p-5 mb-6">
          <h3 class="font-bold font-display mb-3">📝 ملاحظاتي على هذا الدرس</h3>
          <form id="noteForm" class="flex gap-2 mb-3">
            <input name="body" required maxlength="2000" placeholder="اكتب ملاحظة..." class="field flex-1" />
            <button class="btn btn-primary btn-sm">حفظ</button>
          </form>
          <div id="notesList" class="space-y-2">
            ${notes.length ? notes.map(n => `
              <div class="flex items-start gap-2 bg-slate-50 rounded-lg p-3 text-sm">
                <span class="flex-1">${esc(n.body)}</span>
                <button data-note="${n.id}" class="text-slate-400 hover:text-rose-600">🗑</button>
              </div>`).join('') : '<p class="text-sm text-slate-400">لا ملاحظات بعد.</p>'}
          </div>
        </div>

        <!-- الأسئلة والأجوبة -->
        <div class="card p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold font-display">💬 أسئلة وأجوبة</h3>
            <button id="askBtn" class="btn btn-ghost btn-sm">اسأل المعلّم</button>
          </div>
          <div id="qaList">${spinner('')}</div>
        </div>
      </div>`;

    renderSidebar();
    wireLesson(lesson, nextLesson);
    loadQa();
  };

  const saveProgress = async (payload) => {
    try {
      const result = await api.post(`/courses/${course.id}/lessons/${currentId}/progress`, payload);
      if (payload.completed !== undefined) {
        progressMap.set(currentId, { completed: payload.completed });
        renderSidebar();
      }
      return result;
    } catch { /* التقدّم غير حرج — نتجاهل الفشل المؤقّت */ }
  };

  const wireLesson = (lesson, nextLesson) => {
    const player = document.getElementById('player');
    if (player) {
      // نحفظ وقت المشاهدة كل ١٥ ثانية، ونُكمل الدرس تلقائياً عند ٩٥٪
      player.addEventListener('timeupdate', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveProgress({ seconds_watched: Math.floor(player.currentTime) }), 15000);
        if (player.duration && player.currentTime / player.duration > 0.95 && !progressMap.get(lesson.id)?.completed) {
          saveProgress({ completed: true, seconds_watched: Math.floor(player.currentTime) });
        }
      });
    }

    document.getElementById('completeBtn').addEventListener('click', async (e) => {
      const nowDone = !progressMap.get(currentId)?.completed;
      e.target.disabled = true;
      await saveProgress({ completed: nowDone });
      toast(nowDone ? 'أحسنت! درس مكتمل ✅' : 'أُلغيت علامة الإكمال', 'success');
      e.target.disabled = false;
      openLesson();
    });

    document.getElementById('nextBtn')?.addEventListener('click', () => {
      currentId = nextLesson.id; openLesson();
    });

    const noteForm = document.getElementById('noteForm');
    noteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = noteForm.body.value.trim();
      if (!body) return;
      try {
        await api.post(`/courses/${course.id}/lessons/${currentId}/notes`, { body });
        noteForm.reset();
        toast('حُفظت الملاحظة', 'success');
        openLesson();
      } catch (err) { toast(err.message, 'error'); }
    });

    document.querySelectorAll('[data-note]').forEach(btn => btn.addEventListener('click', async () => {
      await api.delete(`/courses/notes/${btn.dataset.note}`);
      btn.closest('div').remove();
    }));

    document.getElementById('askBtn').addEventListener('click', () => askQuestion(course.id, currentId, loadQa));
  };

  const loadQa = async () => {
    const list = document.getElementById('qaList');
    if (!list) return;
    try {
      const { data: questions } = await api.get(`/courses/${course.id}/questions`);
      list.innerHTML = questions.length ? questions.map(question => `
        <div class="border-b last:border-0 py-3">
          <button data-question="${question.id}" class="w-full text-right">
            <p class="font-semibold text-sm ${question.resolved ? 'text-slate-500' : 'text-slate-900'}">
              ${question.resolved ? '✅ ' : '❓ '}${esc(question.title)}</p>
            <p class="text-xs text-slate-400 mt-0.5">${esc(question.user_name)} • ${fromNow(question.created_at)} • ${question.answers_count} إجابة</p>
          </button>
        </div>`).join('') : '<p class="text-sm text-slate-400">لا أسئلة بعد — كن أول السائلين.</p>';

      list.querySelectorAll('[data-question]').forEach(btn =>
        btn.addEventListener('click', () => openQuestion(btn.dataset.question, loadQa)));
    } catch { list.innerHTML = ''; }
  };

  renderShell();
  try {
    const library = await api.get('/me/library');
    const enrolled = library.courses.find(c => c.id === course.id);
    if (enrolled) {
      // نعيد بناء خريطة الإكمال من الدروس التي سجّل الخادم إتمامها
      const detail = await api.get(`/courses/${course.id}`);
      progressMap = new Map();
      for (const lesson of detail.curriculum.flatMap(s => s.lessons)) {
        progressMap.set(lesson.id, { completed: false });
      }
    }
  } catch {}
  await openLesson();
}

/* ============================ نوافذ الأسئلة ============================ */
function askQuestion(courseId, lessonId, onDone) {
  const dialog = modal({
    title: 'اطرح سؤالك',
    body: `<form id="askForm" class="space-y-3">
      <div><label class="label">عنوان السؤال</label><input name="title" required minlength="5" class="field" /></div>
      <div><label class="label">التفاصيل</label><textarea name="body" rows="4" class="field"></textarea></div>
      <button class="btn btn-primary w-full">إرسال السؤال</button></form>`,
  });
  dialog.el.querySelector('#askForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(e.target));
      await api.post(`/courses/${courseId}/questions`, { ...values, lesson_id: lessonId });
      toast('أُرسل سؤالك للمعلّم 💬', 'success');
      dialog.close(); onDone?.();
    } catch (err) { toast(err.message, 'error'); }
  });
}

export async function openQuestion(questionId, onDone) {
  const data = await api.get(`/questions/${questionId}/answers`);
  const dialog = modal({
    title: data.question.title,
    size: 'max-w-2xl',
    body: `
      ${data.question.body ? `<p class="text-slate-700 mb-4 leading-relaxed">${esc(data.question.body)}</p>` : ''}
      <div class="space-y-3 mb-4" id="answers">
        ${data.answers.length ? data.answers.map(a => `
          <div class="rounded-xl p-3 ${a.is_instructor ? 'bg-brand-50 border border-brand-200' : 'bg-slate-50'}">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-bold text-sm">${esc(a.user_name)}</span>
              ${a.is_instructor ? '<span class="badge bg-brand-600 text-white">المعلّم</span>' : ''}
              ${a.accepted ? '<span class="badge bg-amber-100 text-amber-700">✓ الإجابة المعتمدة</span>' : ''}
              <span class="text-xs text-slate-400 mr-auto">${fromNow(a.created_at)}</span>
            </div>
            <p class="text-sm text-slate-700 leading-relaxed">${esc(a.body)}</p>
            ${data.question.user_id === state.user?.id && !a.accepted
              ? `<button data-accept="${a.id}" class="text-xs text-brand-700 font-semibold mt-2 hover:underline">اعتماد كإجابة صحيحة</button>` : ''}
          </div>`).join('') : '<p class="text-sm text-slate-400">لا توجد إجابات بعد.</p>'}
      </div>
      <form id="answerForm" class="flex gap-2">
        <input name="body" required placeholder="اكتب إجابتك..." class="field flex-1" />
        <button class="btn btn-primary btn-sm">إرسال</button>
      </form>`,
  });

  dialog.el.querySelector('#answerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post(`/questions/${questionId}/answers`, { body: e.target.body.value });
      dialog.close(); toast('أُرسلت إجابتك', 'success'); onDone?.();
      openQuestion(questionId, onDone);
    } catch (err) { toast(err.message, 'error'); }
  });

  dialog.el.querySelectorAll('[data-accept]').forEach(btn => btn.addEventListener('click', async () => {
    await api.post(`/answers/${btn.dataset.accept}/accept`);
    toast('اعتُمدت الإجابة ✅', 'success');
    dialog.close(); onDone?.();
  }));
}

/* ============================ صفحة الاختبار ============================ */
export async function quizPage({ view, params }) {
  view.innerHTML = spinner('نجهّز الاختبار...');

  let data;
  try { data = await api.get(`/quizzes/${params.quizId}`); }
  catch (err) { view.innerHTML = errorState(err.message); return; }

  const { quiz, questions, attempts, exhausted } = data;

  if (exhausted) {
    view.innerHTML = section(emptyState('🚫', 'استنفدت المحاولات',
      `الحد المسموح ${quiz.attempts_allowed} محاولات. أفضل نتيجة: ${Math.max(...attempts.map(a => a.percent), 0)}٪`,
      '<a href="#/my-learning" class="btn btn-primary">العودة لمكتبتي</a>'));
    return;
  }

  const answers = {};
  let remaining = quiz.time_limit_seconds;
  let timer = null;

  const render = () => {
    view.innerHTML = section(`
      <div class="max-w-3xl mx-auto">
        <div class="card p-5 mb-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 class="text-xl font-extrabold font-display">${esc(quiz.title)}</h1>
            <p class="text-sm text-slate-500">${questions.length} سؤال • النجاح من ${quiz.pass_score}٪
              ${attempts.length ? ` • محاولة ${attempts.length + 1} من ${quiz.attempts_allowed || '∞'}` : ''}</p>
          </div>
          ${quiz.time_limit_seconds ? '<div id="timer" class="text-2xl font-bold tabular-nums text-brand-700"></div>' : ''}
        </div>

        <form id="quizForm" class="space-y-4">
          ${questions.map((question, i) => `
            <div class="card p-5">
              <p class="font-bold mb-3"><span class="text-brand-600">${i + 1}.</span> ${esc(question.text)}
                <span class="text-xs text-slate-400 font-normal">(${question.points} نقطة${question.type === 'multi' ? ' — أكثر من إجابة' : ''})</span></p>
              <div class="space-y-2">
                ${question.options.map((option, oi) => `
                  <label class="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-brand-400 hover:bg-brand-50/40 cursor-pointer transition-colors">
                    <input type="${question.type === 'multi' ? 'checkbox' : 'radio'}" name="q_${question.id}" value="${oi}"
                           class="w-4 h-4 accent-emerald-600" />
                    <span class="text-sm">${esc(option)}</span>
                  </label>`).join('')}
              </div>
            </div>`).join('')}
          <button class="btn btn-primary w-full text-lg">تسليم الإجابات</button>
        </form>
      </div>`);

    document.getElementById('quizForm').addEventListener('submit', submit);
    if (quiz.time_limit_seconds) startTimer();
  };

  const startTimer = () => {
    const el = document.getElementById('timer');
    timer = setInterval(() => {
      remaining -= 1;
      const m = String(Math.floor(remaining / 60)).padStart(2, '0');
      const s = String(remaining % 60).padStart(2, '0');
      el.textContent = `⏱ ${m}:${s}`;
      if (remaining <= 30) el.classList.add('text-rose-600');
      if (remaining <= 0) { clearInterval(timer); toast('انتهى الوقت — سيتم التسليم', 'warn'); submit(); }
    }, 1000);
  };

  const submit = async (e) => {
    e?.preventDefault();
    clearInterval(timer);
    const form = document.getElementById('quizForm');
    for (const question of questions) {
      answers[question.id] = [...form.querySelectorAll(`[name="q_${question.id}"]:checked`)].map(i => Number(i.value));
    }
    try {
      const result = await api.post(`/quizzes/${quiz.id}/submit`, { answers });
      showResult(result);
    } catch (err) { toast(err.message, 'error'); }
  };

  const showResult = (result) => {
    view.innerHTML = section(`
      <div class="max-w-3xl mx-auto">
        <div class="card p-8 text-center mb-6 ${result.passed ? 'border-2 border-brand-500' : 'border-2 border-amber-400'}">
          <div class="text-6xl mb-3">${result.passed ? '🎉' : '📚'}</div>
          <h1 class="text-2xl font-extrabold font-display mb-2">${esc(result.message)}</h1>
          <p class="text-4xl font-extrabold ${result.passed ? 'text-brand-600' : 'text-amber-600'} my-4">${result.percent}٪</p>
          <p class="text-slate-500">${result.score} من ${result.maxScore} نقطة</p>
          <div class="flex gap-2 justify-center mt-6 flex-wrap">
            <a href="#/my-learning" class="btn btn-primary">مكتبتي</a>
            ${!result.passed ? `<a href="#/quiz/${quiz.id}" class="btn btn-ghost">إعادة المحاولة</a>` : ''}
          </div>
        </div>

        <h2 class="font-bold font-display mb-3">مراجعة الإجابات</h2>
        <div class="space-y-3">
          ${result.breakdown.map((item, i) => {
            const question = questions.find(q => q.id === item.question_id);
            return `
              <div class="card p-4 ${item.isCorrect ? 'border-r-4 border-r-brand-500' : 'border-r-4 border-r-rose-500'}">
                <p class="font-bold text-sm mb-2">${item.isCorrect ? '✅' : '❌'} ${i + 1}. ${esc(question.text)}</p>
                <p class="text-xs text-slate-600">إجابتك: ${item.given.map(g => esc(question.options[g])).join('، ') || '—'}</p>
                ${!item.isCorrect ? `<p class="text-xs text-brand-700 font-semibold mt-1">الصحيح: ${item.correct.map(c => esc(question.options[c])).join('، ')}</p>` : ''}
                ${item.explanation ? `<p class="text-xs text-slate-500 mt-2 bg-slate-50 rounded-lg p-2">💡 ${esc(item.explanation)}</p>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`);
  };

  render();
  return () => clearInterval(timer);
}
