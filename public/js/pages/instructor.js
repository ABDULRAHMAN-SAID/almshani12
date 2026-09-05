import { api } from '../api.js';
import { state } from '../store.js';
import {
  esc, money, spinner, section, pageHeader, emptyState, errorState, toast,
  formatDate, fromNow, confirmDialog, modal, duration,
} from '../ui.js';
import { navigate } from '../router.js';
import { openQuestion } from './learn.js';

const NAV = [
  ['#/instructor', '📊 اللوحة'],
  ['#/instructor/courses', '🎬 دوراتي'],
  ['#/instructor/live', '🔴 حصصي'],
  ['#/instructor/summaries', '📖 ملخّصاتي'],
  ['#/instructor/students', '🎓 طلابي'],
  ['#/instructor/questions', '💬 الأسئلة'],
  ['#/instructor/earnings', '💰 الأرباح'],
  ['#/instructor/coupons', '🎟 الكوبونات'],
];

const shell = (title, subtitle, body) => {
  const current = location.hash.split('?')[0];
  return pageHeader(title, subtitle,
    `<div class="flex gap-1.5 mt-5 overflow-x-auto pb-1">
      ${NAV.map(([href, label]) => `
        <a href="${href}" class="px-3 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-colors
           ${current === href ? 'bg-white text-brand-800' : 'bg-black/20 text-white/80 hover:bg-black/30'}">${label}</a>`).join('')}
    </div>`) + section(body);
};

const statusBadge = (status) => ({
  draft: '<span class="badge bg-slate-200 text-slate-700">مسوّدة</span>',
  pending: '<span class="badge bg-amber-100 text-amber-700">قيد المراجعة</span>',
  published: '<span class="badge bg-brand-100 text-brand-700">منشورة</span>',
  rejected: '<span class="badge bg-rose-100 text-rose-700">مرفوضة</span>',
  archived: '<span class="badge bg-slate-200 text-slate-500">مؤرشفة</span>',
}[status] || status);

/* ============================ لوحة المعلّم ============================ */
export async function dashboard({ view }) {
  view.innerHTML = spinner();
  let data;
  try { data = await api.get('/instructor/dashboard'); }
  catch (err) { view.innerHTML = errorState(err.message); return; }

  const s = data.stats;
  const card = (icon, value, label) => `
    <div class="card p-4 text-center">
      <div class="text-2xl mb-1">${icon}</div>
      <div class="text-xl font-extrabold font-display">${value}</div>
      <div class="text-xs text-slate-500">${label}</div>
    </div>`;

  view.innerHTML = shell('لوحة المعلّم', `مرحباً ${state.user.name}`, `
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-8">
      ${card('🎬', s.courses, 'دورة')}
      ${card('✅', s.published, 'منشورة')}
      ${card('📖', s.summaries, 'ملخّص')}
      ${card('🔴', s.liveSessions, 'حصة')}
      ${card('🎓', s.students, 'طالب')}
      ${card('⭐', (s.rating || 0).toFixed(1), 'التقييم')}
      ${card('💰', money(s.balance), 'رصيد قابل للسحب')}
      ${card('💵', money(s.revenue), 'إجمالي الأرباح')}
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-6">
        <div class="card p-5">
          <h2 class="font-bold font-display mb-4">📈 الأرباح الشهرية</h2>
          ${data.monthly.length ? `
            <div class="flex items-end gap-2 h-40 justify-start">
              ${(() => {
                const max = Math.max(...data.monthly.map(m => m.revenue), 1);
                return [...data.monthly].reverse().map(m => `
                  <div class="flex-1 h-full flex flex-col items-center justify-end gap-1 group max-w-16">
                    <span class="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">${money(m.revenue)}</span>
                    <div class="w-full bg-brand-500 rounded-t-lg hover:bg-brand-600 transition-colors"
                         style="height:${Math.max(6, (m.revenue / max) * 92)}%" title="${m.month}: ${money(m.revenue)}"></div>
                    <span class="text-[10px] text-slate-400">${m.month.slice(5)}</span>
                  </div>`).join('');
              })()}
            </div>` : '<p class="text-slate-500 text-sm">لا مبيعات بعد.</p>'}
        </div>

        <div class="card p-5">
          <h2 class="font-bold font-display mb-4">🛒 آخر المبيعات</h2>
          ${data.recentSales.length ? `<div class="space-y-2">
            ${data.recentSales.map(sale => `
              <div class="flex justify-between items-center py-2 border-b last:border-0 text-sm">
                <div class="min-w-0"><p class="font-semibold truncate">${esc(sale.title)}</p>
                  <p class="text-xs text-slate-500">${esc(sale.buyer)} • ${fromNow(sale.paid_at)}</p></div>
                <span class="font-bold text-brand-600 shrink-0">+${money(sale.instructor_share)}</span>
              </div>`).join('')}</div>`
            : '<p class="text-slate-500 text-sm">لا مبيعات بعد.</p>'}
        </div>
      </div>

      <div class="space-y-4">
        <div class="card p-5">
          <h2 class="font-bold font-display mb-3">⚡ إجراءات سريعة</h2>
          <div class="space-y-2">
            <button id="newCourse" class="btn btn-primary w-full btn-sm">➕ دورة جديدة</button>
            <button id="newLive" class="btn btn-ghost w-full btn-sm">🔴 جدولة حصة</button>
            <button id="newSummary" class="btn btn-ghost w-full btn-sm">📖 ملخّص جديد</button>
          </div>
        </div>

        ${s.pendingQuestions > 0 ? `
          <a href="#/instructor/questions" class="card p-4 block border-r-4 border-r-amber-500 card-hover">
            <p class="font-bold">❓ ${s.pendingQuestions} سؤال بانتظار ردّك</p>
            <p class="text-sm text-slate-500 mt-1">الردّ السريع يرفع تقييمك.</p>
          </a>` : ''}

        <div class="card p-5">
          <h2 class="font-bold font-display mb-3">🔴 حصصك القادمة</h2>
          ${data.upcomingSessions.length ? data.upcomingSessions.map(session => `
            <a href="#/live/${session.id}" class="block py-2 border-b last:border-0">
              <p class="font-semibold text-sm truncate">${esc(session.title)}</p>
              <p class="text-xs text-slate-500">${formatDate(session.starts_at, true)} • ${session.booked}/${session.capacity} محجوز</p>
            </a>`).join('') : '<p class="text-slate-500 text-sm">لا حصص مجدولة.</p>'}
        </div>
      </div>
    </div>`);

  document.getElementById('newCourse').addEventListener('click', () => openCourseForm());
  document.getElementById('newLive').addEventListener('click', () => openLiveForm());
  document.getElementById('newSummary').addEventListener('click', () => openSummaryForm());
}

/* ============================ الدورات ============================ */
export async function courses({ view }) {
  view.innerHTML = shell('دوراتي', '', spinner());
  const data = await api.get('/instructor/courses');

  view.querySelector('#view > div:last-child, .max-w-7xl:last-of-type')?.remove();
  view.innerHTML = shell('دوراتي', `${data.data.length} دورة`, `
    <button id="newCourse" class="btn btn-primary mb-5">➕ دورة جديدة</button>
    ${data.data.length ? `<div class="space-y-3">
      ${data.data.map(course => `
        <div class="card p-4 flex items-center gap-4 flex-wrap">
          <div class="flex-1 min-w-52">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <h3 class="font-bold">${esc(course.title)}</h3>
              ${statusBadge(course.status)}
            </div>
            <p class="text-xs text-slate-500">${course.lessons_count} درس • ${course.students} طالب •
              ${course.price === 0 ? 'مجانية' : money(course.discount_price ?? course.price)}</p>
            ${course.reject_reason ? `<p class="text-xs text-rose-600 mt-1">سبب الرفض: ${esc(course.reject_reason)}</p>` : ''}
          </div>
          <div class="flex gap-2">
            <a href="#/instructor/courses/${course.id}" class="btn btn-ghost btn-sm">✏️ تحرير</a>
            ${course.status === 'published' ? `<a href="#/courses/${esc(course.slug)}" class="btn btn-ghost btn-sm">👁 عرض</a>` : ''}
            ${['draft', 'rejected'].includes(course.status) && course.lessons_count > 0
              ? `<button data-submit="${course.id}" class="btn btn-primary btn-sm">📤 إرسال للمراجعة</button>` : ''}
            <button data-delete="${course.id}" class="btn btn-ghost btn-sm text-rose-600">🗑</button>
          </div>
        </div>`).join('')}</div>`
      : emptyState('🎬', 'لم تنشئ دورات بعد', 'ابدأ بإنشاء أول دورة لك ثم أضف الدروس.')}`);

  document.getElementById('newCourse').addEventListener('click', () => openCourseForm());

  view.querySelectorAll('[data-submit]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.post(`/courses/${btn.dataset.submit}/submit`);
      toast('أُرسلت الدورة للمراجعة 📤', 'success');
      courses({ view });
    } catch (err) { toast(err.message, 'error'); }
  }));

  view.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDialog('حذف هذه الدورة؟ إن كان فيها مشتركون فستُؤرشف بدل الحذف.')) return;
    const result = await api.delete(`/courses/${btn.dataset.delete}`);
    toast(result.message || 'تم الحذف', 'info');
    courses({ view });
  }));
}

function openCourseForm(course = null) {
  api.get('/categories').then(({ data: categories }) => {
    const dialog = modal({
      title: course ? 'تعديل الدورة' : 'دورة جديدة', size: 'max-w-2xl',
      body: `<form id="courseForm" class="space-y-4">
        <div><label class="label">عنوان الدورة *</label>
          <input name="title" required minlength="3" value="${esc(course?.title || '')}" class="field" /></div>
        <div><label class="label">العنوان الفرعي</label>
          <input name="subtitle" value="${esc(course?.subtitle || '')}" class="field" /></div>
        <div><label class="label">الوصف</label>
          <textarea name="description" rows="4" class="field">${esc(course?.description || '')}</textarea></div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div><label class="label">التصنيف</label>
            <select name="category_id" class="field">
              <option value="">— اختر —</option>
              ${categories.map(c => `<option value="${c.id}" ${course?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select></div>
          <div><label class="label">المستوى</label>
            <select name="level" class="field">
              ${[['beginner', 'مبتدئ'], ['intermediate', 'متوسّط'], ['advanced', 'متقدّم'], ['all', 'جميع المستويات']]
                .map(([v, l]) => `<option value="${v}" ${course?.level === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
          <div><label class="label">نوع الدورة</label>
            <select name="type" class="field">
              ${[['recorded', 'مسجّلة'], ['live', 'مباشرة'], ['hybrid', 'مختلطة']]
                .map(([v, l]) => `<option value="${v}" ${course?.type === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
          <div><label class="label">السعر</label>
            <input name="price" type="number" min="0" step="0.5" value="${course?.price ?? 0}" class="field" /></div>
          <div><label class="label">سعر العرض (اختياري)</label>
            <input name="discount_price" type="number" min="0" step="0.5" value="${course?.discount_price ?? ''}" class="field" /></div>
          <div><label class="label">رابط الصورة</label>
            <input name="thumbnail" value="${esc(course?.thumbnail || '')}" class="field" placeholder="https://..." /></div>
        </div>
        <div><label class="label">ماذا سيتعلّم الطالب؟ (سطر لكل مخرج)</label>
          <textarea name="outcomes" rows="3" class="field">${esc((course?.outcomes || []).join('\n'))}</textarea></div>
        <div><label class="label">المتطلّبات (سطر لكل متطلّب)</label>
          <textarea name="requirements" rows="2" class="field">${esc((course?.requirements || []).join('\n'))}</textarea></div>
        <button class="btn btn-primary w-full">${course ? 'حفظ التعديلات' : 'إنشاء الدورة'}</button>
      </form>`,
    });

    dialog.el.querySelector('#courseForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.target));
      const payload = {
        ...values,
        price: Number(values.price),
        discount_price: values.discount_price === '' ? null : Number(values.discount_price),
        category_id: values.category_id === '' ? null : Number(values.category_id),
        outcomes: values.outcomes.split('\n').map(v => v.trim()).filter(Boolean),
        requirements: values.requirements.split('\n').map(v => v.trim()).filter(Boolean),
      };
      try {
        const saved = course ? await api.patch(`/courses/${course.id}`, payload) : await api.post('/courses', payload);
        dialog.close();
        toast(course ? 'حُفظت التعديلات ✅' : 'أُنشئت الدورة — أضف الدروس الآن', 'success');
        navigate(`/instructor/courses/${saved.id}`);
      } catch (err) { toast(err.message, 'error', 6000); }
    });
  });
}

/* ============================ محرّر الدورة ============================ */
export async function courseEditor({ view, params }) {
  view.innerHTML = spinner();
  let data;
  try { data = await api.get(`/courses/${params.id}`); }
  catch (err) { view.innerHTML = errorState(err.message, '#/instructor/courses'); return; }

  const { course, curriculum } = data;

  const render = () => {
    view.innerHTML = shell(course.title, 'تحرير محتوى الدورة', `
      <div class="flex flex-wrap gap-2 mb-6">
        <button id="editInfo" class="btn btn-ghost btn-sm">✏️ بيانات الدورة</button>
        <button id="addSection" class="btn btn-ghost btn-sm">➕ قسم جديد</button>
        <button id="addLesson" class="btn btn-primary btn-sm">➕ درس جديد</button>
        <button id="addQuiz" class="btn btn-amber btn-sm">📝 اختبار جديد</button>
        <span class="mr-auto">${statusBadge(course.status)}</span>
        ${['draft', 'rejected'].includes(course.status)
          ? '<button id="submitBtn" class="btn btn-primary btn-sm">📤 إرسال للمراجعة</button>' : ''}
      </div>

      ${curriculum.length ? curriculum.map(sec => `
        <div class="card mb-4 overflow-hidden">
          <div class="px-4 py-3 bg-slate-50 font-bold flex justify-between items-center">
            <span>${esc(sec.title)}</span>
            <span class="text-xs text-slate-500 font-normal">${sec.lessons.length} درس</span>
          </div>
          ${sec.lessons.map(lesson => `
            <div class="flex items-center gap-3 px-4 py-3 border-t text-sm">
              <span>${{ video: '▶️', article: '📄', pdf: '📕', quiz: '📝', live: '🔴', audio: '🎧' }[lesson.type] || '📄'}</span>
              <span class="flex-1">${esc(lesson.title)}</span>
              ${lesson.is_free_preview ? '<span class="badge bg-brand-100 text-brand-700">معاينة</span>' : ''}
              <span class="text-xs text-slate-400">${lesson.duration_seconds ? duration(lesson.duration_seconds) : ''}</span>
              <button data-del-lesson="${lesson.id}" class="text-slate-400 hover:text-rose-600">🗑</button>
            </div>`).join('') || '<p class="px-4 py-3 text-sm text-slate-400 border-t">لا دروس في هذا القسم</p>'}
        </div>`).join('')
        : emptyState('📚', 'لا محتوى بعد', 'ابدأ بإضافة قسم ثم دروس داخله.')}`);

    document.getElementById('editInfo').addEventListener('click', () => openCourseForm(course));
    document.getElementById('submitBtn')?.addEventListener('click', async () => {
      try {
        await api.post(`/courses/${course.id}/submit`);
        toast('أُرسلت للمراجعة 📤', 'success');
        navigate('/instructor/courses');
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('addSection').addEventListener('click', () => {
      const dialog = modal({
        title: 'قسم جديد',
        body: `<form id="sectionForm" class="space-y-3">
          <div><label class="label">عنوان القسم</label><input name="title" required class="field" /></div>
          <button class="btn btn-primary w-full">إضافة</button></form>`,
      });
      dialog.el.querySelector('#sectionForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await api.post(`/courses/${course.id}/sections`, {
          title: e.target.title.value, position: curriculum.length,
        });
        dialog.close(); toast('أُضيف القسم', 'success');
        courseEditor({ view, params });
      });
    });

    document.getElementById('addLesson').addEventListener('click', () => {
      const dialog = modal({
        title: 'درس جديد', size: 'max-w-xl',
        body: `<form id="lessonForm" class="space-y-3">
          <div><label class="label">عنوان الدرس *</label><input name="title" required class="field" /></div>
          <div class="grid sm:grid-cols-2 gap-3">
            <div><label class="label">القسم</label>
              <select name="section_id" class="field">
                <option value="">بدون قسم</option>
                ${curriculum.filter(s => s.id).map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}
              </select></div>
            <div><label class="label">النوع</label>
              <select name="type" class="field">
                ${[['video', 'فيديو'], ['article', 'مقال'], ['pdf', 'ملف PDF'], ['audio', 'صوتي']]
                  .map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
              </select></div>
          </div>
          <div><label class="label">رابط المحتوى (فيديو/ملف)</label>
            <input name="content_url" class="field" placeholder="https://..." /></div>
          <div><label class="label">أو نصّ الدرس (Markdown)</label>
            <textarea name="content_text" rows="4" class="field"></textarea></div>
          <div class="grid sm:grid-cols-2 gap-3">
            <div><label class="label">المدة (بالثواني)</label>
              <input name="duration_seconds" type="number" min="0" value="0" class="field" /></div>
            <label class="flex items-center gap-2 mt-6 text-sm font-semibold">
              <input type="checkbox" name="is_free_preview" class="w-4 h-4 accent-emerald-600" /> معاينة مجانية</label>
          </div>
          <button class="btn btn-primary w-full">إضافة الدرس</button></form>`,
      });
      dialog.el.querySelector('#lessonForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.target));
        try {
          await api.post(`/courses/${course.id}/lessons`, {
            ...values,
            section_id: values.section_id === '' ? null : Number(values.section_id),
            duration_seconds: Number(values.duration_seconds || 0),
            is_free_preview: !!values.is_free_preview,
            content_url: values.content_url || null,
            content_text: values.content_text || null,
          });
          dialog.close(); toast('أُضيف الدرس ✅', 'success');
          courseEditor({ view, params });
        } catch (err) { toast(err.message, 'error', 6000); }
      });
    });

    document.getElementById('addQuiz').addEventListener('click', () => openQuizForm({ course_id: course.id }));

    view.querySelectorAll('[data-del-lesson]').forEach(btn => btn.addEventListener('click', async () => {
      if (!await confirmDialog('حذف هذا الدرس؟')) return;
      await api.delete(`/courses/${course.id}/lessons/${btn.dataset.delLesson}`);
      toast('حُذف الدرس', 'info');
      courseEditor({ view, params });
    }));
  };

  render();
}

/** نموذج إنشاء اختبار (يصلح للدورات وللحصص المباشرة). */
export function openQuizForm(context = {}) {
  let questionCount = 1;

  const questionBlock = (index) => `
    <div class="border rounded-xl p-3 space-y-2" data-question>
      <div class="flex justify-between items-center">
        <span class="font-bold text-sm">السؤال ${index + 1}</span>
        <button type="button" data-remove-q class="text-rose-600 text-sm">حذف</button>
      </div>
      <input name="q_text" required placeholder="نصّ السؤال" class="field" />
      ${[0, 1, 2, 3].map(i => `
        <div class="flex items-center gap-2">
          <input type="radio" name="correct_${index}" value="${i}" ${i === 0 ? 'checked' : ''} class="w-4 h-4 accent-emerald-600" />
          <input name="q_option" placeholder="الخيار ${i + 1}${i > 1 ? ' (اختياري)' : ''}" ${i < 2 ? 'required' : ''} class="field flex-1" />
        </div>`).join('')}
      <input name="q_explanation" placeholder="شرح الإجابة (اختياري)" class="field text-sm" />
    </div>`;

  const dialog = modal({
    title: 'اختبار جديد', size: 'max-w-2xl',
    body: `<form id="quizForm" class="space-y-4">
      <div><label class="label">عنوان الاختبار *</label><input name="title" required class="field" /></div>
      <div class="grid sm:grid-cols-3 gap-3">
        <div><label class="label">نسبة النجاح ٪</label><input name="pass_score" type="number" min="0" max="100" value="60" class="field" /></div>
        <div><label class="label">المحاولات المسموحة</label><input name="attempts_allowed" type="number" min="0" max="20" value="3" class="field" /></div>
        <div><label class="label">الوضع</label>
          <select name="mode" class="field">
            <option value="graded">مُقيَّم (شرط الشهادة)</option>
            <option value="practice">تدريبي</option>
            <option value="live" ${context.live_session_id ? 'selected' : ''}>مسابقة مباشرة</option>
          </select></div>
      </div>
      <div id="questions" class="space-y-3">${questionBlock(0)}</div>
      <button type="button" id="addQ" class="btn btn-ghost btn-sm w-full">➕ سؤال آخر</button>
      <button class="btn btn-primary w-full">حفظ الاختبار</button>
    </form>`,
  });

  const wireRemove = () => {
    dialog.el.querySelectorAll('[data-remove-q]').forEach(btn => btn.onclick = () => {
      if (dialog.el.querySelectorAll('[data-question]').length <= 1) return toast('يجب سؤال واحد على الأقل', 'warn');
      btn.closest('[data-question]').remove();
    });
  };
  wireRemove();

  dialog.el.querySelector('#addQ').addEventListener('click', () => {
    dialog.el.querySelector('#questions').insertAdjacentHTML('beforeend', questionBlock(questionCount++));
    wireRemove();
  });

  dialog.el.querySelector('#quizForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const questions = [...dialog.el.querySelectorAll('[data-question]')].map((block, i) => {
      const options = [...block.querySelectorAll('[name="q_option"]')].map(input => input.value.trim()).filter(Boolean);
      const checked = block.querySelector('input[type="radio"]:checked');
      return {
        text: block.querySelector('[name="q_text"]').value,
        type: 'single',
        options,
        correct: [Math.min(Number(checked?.value ?? 0), options.length - 1)],
        points: 1,
        explanation: block.querySelector('[name="q_explanation"]').value || null,
        time_seconds: 20,
      };
    });

    try {
      await api.post('/quizzes', {
        ...context,
        title: form.title.value,
        mode: form.mode.value,
        pass_score: Number(form.pass_score.value),
        attempts_allowed: Number(form.attempts_allowed.value),
        questions,
      });
      dialog.close();
      toast('أُنشئ الاختبار ✅', 'success');
    } catch (err) { toast(err.message, 'error', 6000); }
  });
}

/* ============================ الحصص ============================ */
export async function live({ view }) {
  view.innerHTML = shell('حصصي المباشرة', '', spinner());
  const data = await api.get('/instructor/live');

  view.innerHTML = shell('حصصي المباشرة', `${data.data.length} حصة`, `
    <button id="newLive" class="btn btn-primary mb-5">➕ جدولة حصة</button>
    ${data.data.length ? `<div class="space-y-3">
      ${data.data.map(session => {
        const upcoming = new Date(session.starts_at) > new Date();
        return `
          <div class="card p-4 flex items-center gap-4 flex-wrap">
            <div class="text-3xl">${session.status === 'live' ? '🔴' : session.status === 'cancelled' ? '🚫' : upcoming ? '📅' : '🗄'}</div>
            <div class="flex-1 min-w-52">
              <h3 class="font-bold">${esc(session.title)}</h3>
              <p class="text-xs text-slate-500">${formatDate(session.starts_at, true)} • ${session.duration_minutes} دقيقة •
                ${session.booked}/${session.capacity} محجوز • ${session.price === 0 ? 'مجانية' : money(session.price)}</p>
            </div>
            <div class="flex gap-2 flex-wrap">
              ${session.status !== 'ended' && session.status !== 'cancelled'
                ? `<a href="#/live/${session.id}/room" class="btn ${session.status === 'live' ? 'btn-danger' : 'btn-primary'} btn-sm">
                     ${session.status === 'live' ? '🔴 القاعة' : '🚪 ادخل القاعة'}</a>` : ''}
              <button data-quiz="${session.id}" class="btn btn-amber btn-sm">📝 مسابقة</button>
              <button data-attendance="${session.id}" class="btn btn-ghost btn-sm">📋 الحضور</button>
              ${upcoming && session.status === 'scheduled'
                ? `<button data-cancel="${session.id}" class="btn btn-ghost btn-sm text-rose-600">إلغاء</button>` : ''}
            </div>
          </div>`;
      }).join('')}</div>`
      : emptyState('🔴', 'لا حصص مجدولة', 'اجدول حصتك الأولى وابدأ التدريس المباشر.')}`);

  document.getElementById('newLive').addEventListener('click', () => openLiveForm());

  view.querySelectorAll('[data-quiz]').forEach(btn =>
    btn.addEventListener('click', () => openQuizForm({ live_session_id: Number(btn.dataset.quiz) })));

  view.querySelectorAll('[data-attendance]').forEach(btn => btn.addEventListener('click', async () => {
    const result = await api.get(`/live/${btn.dataset.attendance}/attendance`);
    modal({
      title: 'كشف الحضور', size: 'max-w-2xl',
      body: `<table class="w-full text-sm">
        <thead class="text-right text-slate-500 border-b"><tr><th class="pb-2">الطالب</th><th>الحالة</th><th>الدقائق</th></tr></thead>
        <tbody>${result.attendance.map(a => `<tr class="border-b last:border-0">
          <td class="py-2 font-semibold">${esc(a.name)}</td>
          <td>${{ booked: '⏳ محجوز', attended: '✅ حضر', absent: '❌ غائب', cancelled: '🚫 ملغى', refunded: '💸 مُسترجع' }[a.status] || a.status}</td>
          <td class="tabular-nums">${a.attendance_minutes || 0}</td></tr>`).join('')
          || '<tr><td colspan="3" class="py-4 text-center text-slate-400">لا حجوزات بعد</td></tr>'}</tbody></table>`,
    });
  }));

  view.querySelectorAll('[data-cancel]').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDialog('إلغاء الحصة؟ سيُشعَر كل من حجز.')) return;
    await api.post(`/live/${btn.dataset.cancel}/cancel`, { reason: 'ظرف طارئ' });
    toast('أُلغيت الحصة وأُشعر الحاضرون', 'info');
    live({ view });
  }));
}

function openLiveForm() {
  Promise.all([api.get('/instructor/courses'), api.get('/categories')]).then(([myCourses, categories]) => {
    const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 86400000)
      .toISOString().slice(0, 16);

    const dialog = modal({
      title: 'جدولة حصة مباشرة', size: 'max-w-xl',
      body: `<form id="liveForm" class="space-y-3">
        <div><label class="label">عنوان الحصة *</label><input name="title" required class="field" /></div>
        <div><label class="label">الوصف</label><textarea name="description" rows="3" class="field"></textarea></div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div><label class="label">موعد البدء *</label>
            <input name="starts_at" type="datetime-local" required value="${localNow}" class="field" /></div>
          <div><label class="label">المدة (دقيقة)</label>
            <input name="duration_minutes" type="number" min="10" max="600" value="60" class="field" /></div>
          <div><label class="label">عدد المقاعد</label>
            <input name="capacity" type="number" min="1" max="1000" value="30" class="field" /></div>
          <div><label class="label">السعر</label>
            <input name="price" type="number" min="0" step="0.5" value="0" class="field" /></div>
          <div><label class="label">مرتبطة بدورة</label>
            <select name="course_id" class="field"><option value="">— مستقلة —</option>
              ${myCourses.data.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></div>
          <div><label class="label">التصنيف</label>
            <select name="category_id" class="field"><option value="">— اختر —</option>
              ${categories.data.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        </div>
        <div><label class="label">منصّة البثّ</label>
          <select name="meeting_provider" id="providerSelect" class="field">
            <option value="internal">قاعة المنصّة (دردشة + مسابقات)</option>
            <option value="zoom">Zoom</option><option value="meet">Google Meet</option>
            <option value="teams">Teams</option><option value="other">أخرى</option>
          </select></div>
        <div id="urlField" class="hidden"><label class="label">رابط الاجتماع</label>
          <input name="meeting_url" class="field" placeholder="https://..." /></div>
        <button class="btn btn-primary w-full">جدولة الحصة</button>
      </form>`,
    });

    const providerSelect = dialog.el.querySelector('#providerSelect');
    providerSelect.addEventListener('change', () => {
      dialog.el.querySelector('#urlField').classList.toggle('hidden', providerSelect.value === 'internal');
    });

    dialog.el.querySelector('#liveForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.target));
      try {
        await api.post('/live', {
          ...values,
          starts_at: new Date(values.starts_at).toISOString(),
          duration_minutes: Number(values.duration_minutes),
          capacity: Number(values.capacity),
          price: Number(values.price),
          course_id: values.course_id === '' ? null : Number(values.course_id),
          category_id: values.category_id === '' ? null : Number(values.category_id),
          meeting_url: values.meeting_url || null,
        });
        dialog.close(); toast('جُدولت الحصة 🔴', 'success');
        navigate('/instructor/live');
        location.reload();
      } catch (err) { toast(err.message, 'error', 6000); }
    });
  });
}

/* ============================ الملخّصات ============================ */
export async function summaries({ view }) {
  view.innerHTML = shell('ملخّصاتي', '', spinner());
  const data = await api.get('/instructor/summaries');

  view.innerHTML = shell('ملخّصاتي', `${data.data.length} ملخّص`, `
    <button id="newSummary" class="btn btn-primary mb-5">➕ ملخّص جديد</button>
    ${data.data.length ? `<div class="space-y-3">
      ${data.data.map(summary => `
        <div class="card p-4 flex items-center gap-4 flex-wrap">
          <div class="text-3xl">📖</div>
          <div class="flex-1 min-w-52">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <h3 class="font-bold">${esc(summary.title)}</h3>${statusBadge(summary.status)}
            </div>
            <p class="text-xs text-slate-500">«${esc(summary.book_title)}» — ${esc(summary.book_author)} •
              ${summary.reading_minutes} د • ${summary.price === 0 ? 'مجاني' : money(summary.price)} • ${summary.sales_count} عملية بيع</p>
            ${summary.reject_reason ? `<p class="text-xs text-rose-600 mt-1">${esc(summary.reject_reason)}</p>` : ''}
          </div>
          <div class="flex gap-2">
            <button data-edit="${summary.id}" class="btn btn-ghost btn-sm">✏️ تحرير</button>
            ${['draft', 'rejected'].includes(summary.status)
              ? `<button data-submit="${summary.id}" class="btn btn-primary btn-sm">📤 للمراجعة</button>` : ''}
            <button data-delete="${summary.id}" class="btn btn-ghost btn-sm text-rose-600">🗑</button>
          </div>
        </div>`).join('')}</div>`
      : emptyState('📖', 'لم تنشر ملخّصات بعد', 'شارك خلاصة كتاب قرأته واربح من كل عملية بيع.')}`);

  document.getElementById('newSummary').addEventListener('click', () => openSummaryForm());

  view.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', async () => {
    const full = await api.get(`/summaries/${btn.dataset.edit}`);
    openSummaryForm(full.summary);
  }));

  view.querySelectorAll('[data-submit]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.post(`/summaries/${btn.dataset.submit}/submit`);
      toast('أُرسل للمراجعة 📤', 'success');
      summaries({ view });
    } catch (err) { toast(err.message, 'error', 6000); }
  }));

  view.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDialog('حذف هذا الملخّص؟')) return;
    const result = await api.delete(`/summaries/${btn.dataset.delete}`);
    toast(result.message || 'تم الحذف', 'info');
    summaries({ view });
  }));
}

export function openSummaryForm(summary = null) {
  api.get('/categories').then(({ data: categories }) => {
    const dialog = modal({
      title: summary ? 'تعديل الملخّص' : 'ملخّص كتاب جديد', size: 'max-w-3xl',
      body: `<form id="summaryForm" class="space-y-4">
        <div class="grid sm:grid-cols-2 gap-3">
          <div><label class="label">عنوان الملخّص *</label>
            <input name="title" required value="${esc(summary?.title || '')}" class="field" placeholder="ملخّص: اسم الكتاب" /></div>
          <div><label class="label">التصنيف</label>
            <select name="category_id" class="field"><option value="">— اختر —</option>
              ${categories.map(c => `<option value="${c.id}" ${summary?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select></div>
          <div><label class="label">اسم الكتاب *</label>
            <input name="book_title" required value="${esc(summary?.book_title || '')}" class="field" /></div>
          <div><label class="label">مؤلّف الكتاب *</label>
            <input name="book_author" required value="${esc(summary?.book_author || '')}" class="field" /></div>
          <div><label class="label">السعر</label>
            <input name="price" type="number" min="0" step="0.5" value="${summary?.price ?? 0}" class="field" /></div>
          <div><label class="label">مدة القراءة (دقيقة)</label>
            <input name="reading_minutes" type="number" min="1" max="600" value="${summary?.reading_minutes ?? 15}" class="field" /></div>
        </div>
        <div><label class="label">وصف مختصر</label>
          <textarea name="description" rows="2" class="field">${esc(summary?.description || '')}</textarea></div>
        <div><label class="label">الأفكار المفتاحية (سطر لكل فكرة)</label>
          <textarea name="key_ideas" rows="4" class="field">${esc((summary?.key_ideas || []).join('\n'))}</textarea></div>
        <div><label class="label">المقتطف المجاني * <span class="text-slate-400 font-normal">(يظهر لغير المشترين)</span></label>
          <textarea name="preview_content" rows="4" class="field">${esc(summary?.preview_content || '')}</textarea></div>
        <div><label class="label">المحتوى الكامل * <span class="text-slate-400 font-normal">(Markdown — ٢٠٠ حرف على الأقل)</span></label>
          <textarea name="content" rows="10" class="field font-mono text-sm">${esc(summary?.content || '')}</textarea></div>
        <div class="grid sm:grid-cols-3 gap-3">
          <div><label class="label">رابط الغلاف</label><input name="cover" value="${esc(summary?.cover || '')}" class="field" /></div>
          <div><label class="label">رابط PDF</label><input name="pdf_url" value="${esc(summary?.pdf_url || '')}" class="field" /></div>
          <div><label class="label">رابط صوتي</label><input name="audio_url" value="${esc(summary?.audio_url || '')}" class="field" /></div>
        </div>
        <button class="btn btn-primary w-full">${summary ? 'حفظ التعديلات' : 'إنشاء الملخّص'}</button>
      </form>`,
    });

    dialog.el.querySelector('#summaryForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.target));
      const payload = {
        ...values,
        price: Number(values.price),
        reading_minutes: Number(values.reading_minutes),
        category_id: values.category_id === '' ? null : Number(values.category_id),
        key_ideas: values.key_ideas.split('\n').map(v => v.trim()).filter(Boolean),
        cover: values.cover || null, pdf_url: values.pdf_url || null, audio_url: values.audio_url || null,
      };
      try {
        if (summary) await api.patch(`/summaries/${summary.id}`, payload);
        else await api.post('/summaries', payload);
        dialog.close();
        toast(summary ? 'حُفظت التعديلات ✅' : 'أُنشئ الملخّص — أرسله للمراجعة', 'success');
        navigate('/instructor/summaries');
        location.reload();
      } catch (err) { toast(err.message, 'error', 6000); }
    });
  });
}

/* ============================ الطلاب والأسئلة ============================ */
export async function students({ view }) {
  view.innerHTML = shell('طلابي', '', spinner());
  const data = await api.get('/instructor/students');

  view.innerHTML = shell('طلابي', `${data.data.length} تسجيل`, data.data.length ? `
    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-right text-slate-600">
          <tr><th class="p-3">الطالب</th><th class="p-3">البريد</th><th class="p-3">الدورة</th><th class="p-3">التقدّم</th><th class="p-3">التسجيل</th></tr>
        </thead>
        <tbody>
          ${data.data.map(row => `
            <tr class="border-t">
              <td class="p-3 font-semibold">${esc(row.name)}</td>
              <td class="p-3 text-slate-500 text-xs">${esc(row.email)}</td>
              <td class="p-3">${esc(row.course_title)}</td>
              <td class="p-3"><div class="progress w-24"><div style="width:${row.progress_percent}%"></div></div>
                <span class="text-xs text-slate-500">${Math.round(row.progress_percent)}٪</span></td>
              <td class="p-3 text-xs text-slate-500">${formatDate(row.created_at)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('🎓', 'لا طلاب بعد', 'انشر دورتك الأولى ليبدأ الطلاب بالتسجيل.'));
}

export async function questions({ view }) {
  view.innerHTML = shell('أسئلة الطلاب', '', spinner());
  const data = await api.get('/instructor/questions');

  view.innerHTML = shell('أسئلة الطلاب', `${data.data.filter(q => !q.resolved).length} سؤال مفتوح`, data.data.length ? `
    <div class="space-y-3">
      ${data.data.map(question => `
        <div class="card p-4 ${question.resolved ? 'opacity-70' : 'border-r-4 border-r-amber-500'}">
          <button data-question="${question.id}" class="w-full text-right">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold">${question.resolved ? '✅' : '❓'} ${esc(question.title)}</span>
              <span class="badge bg-slate-100 text-slate-600">${question.answers_count} إجابة</span>
            </div>
            <p class="text-xs text-slate-500 mt-1">${esc(question.user_name)} • ${esc(question.course_title)} • ${fromNow(question.created_at)}</p>
            ${question.body ? `<p class="text-sm text-slate-600 mt-2 clamp-2">${esc(question.body)}</p>` : ''}
          </button>
        </div>`).join('')}
    </div>` : emptyState('💬', 'لا أسئلة بعد', 'ستظهر هنا أسئلة طلابك على دوراتك.'));

  view.querySelectorAll('[data-question]').forEach(btn =>
    btn.addEventListener('click', () => openQuestion(btn.dataset.question, () => questions({ view }))));
}

/* ============================ الأرباح ============================ */
export async function earnings({ view }) {
  view.innerHTML = shell('الأرباح', '', spinner());
  const data = await api.get('/instructor/earnings');

  view.innerHTML = shell('الأرباح والسحب', '', `
    <div class="grid lg:grid-cols-3 gap-6">
      <div class="space-y-4">
        <div class="card p-6 text-center bg-gradient-to-bl from-brand-600 to-brand-800 text-white">
          <p class="text-brand-100 text-sm">الرصيد القابل للسحب</p>
          <p class="text-4xl font-extrabold my-3">${money(data.balance)}</p>
          <p class="text-xs text-brand-100 mb-4">إجمالي الأرباح: ${money(data.lifetime)}</p>
          <button id="payoutBtn" class="btn bg-white text-brand-700 hover:bg-brand-50 w-full"
            ${data.balance < data.minPayout ? 'disabled' : ''}>🏦 طلب سحب</button>
          ${data.balance < data.minPayout
            ? `<p class="text-xs text-brand-100 mt-2">الحد الأدنى للسحب ${money(data.minPayout)}</p>` : ''}
        </div>
        <div class="card p-4 text-sm text-slate-600">
          <p class="font-bold text-slate-900 mb-2">كيف تُحتسب أرباحك؟</p>
          <p>تحصل على <span class="font-bold text-brand-700">${Math.round((1 - data.commissionRate) * 100)}٪</span>
             من كل عملية بيع، وعمولة المنصّة ${Math.round(data.commissionRate * 100)}٪.</p>
        </div>
      </div>

      <div class="lg:col-span-2 space-y-6">
        <div class="card p-5">
          <h2 class="font-bold font-display mb-4">💵 الأرباح حسب المنتج</h2>
          ${data.byItem.length ? `<table class="w-full text-sm">
            <thead class="text-right text-slate-500 border-b"><tr><th class="pb-2">المنتج</th><th>المبيعات</th><th class="text-left">الأرباح</th></tr></thead>
            <tbody>${data.byItem.map(item => `<tr class="border-b last:border-0">
              <td class="py-2">${esc(item.title)}</td><td class="tabular-nums">${item.sales}</td>
              <td class="py-2 text-left font-bold text-brand-600">${money(item.revenue)}</td></tr>`).join('')}</tbody>
          </table>` : '<p class="text-slate-500 text-sm">لا مبيعات بعد.</p>'}
        </div>

        <div class="card p-5">
          <h2 class="font-bold font-display mb-4">🏦 طلبات السحب</h2>
          ${data.payouts.length ? `<div class="space-y-2">
            ${data.payouts.map(payout => `
              <div class="flex justify-between items-center py-2 border-b last:border-0 text-sm">
                <div><p class="font-bold">${money(payout.amount)}</p>
                  <p class="text-xs text-slate-500">${formatDate(payout.requested_at)}</p></div>
                <span class="badge ${{ pending: 'bg-amber-100 text-amber-700', approved: 'bg-sky-100 text-sky-700',
                  paid: 'bg-brand-100 text-brand-700', rejected: 'bg-rose-100 text-rose-700' }[payout.status]}">
                  ${{ pending: '⏳ قيد المراجعة', approved: '✅ معتمد', paid: '💸 مصروف', rejected: '❌ مرفوض' }[payout.status]}</span>
              </div>`).join('')}</div>` : '<p class="text-slate-500 text-sm">لا طلبات سحب.</p>'}
        </div>
      </div>
    </div>`);

  document.getElementById('payoutBtn')?.addEventListener('click', () => {
    const dialog = modal({
      title: 'طلب سحب أرباح',
      body: `<form id="payoutForm" class="space-y-3">
        <div><label class="label">المبلغ (الحد الأقصى ${money(data.balance)})</label>
          <input name="amount" type="number" min="${data.minPayout}" max="${data.balance}" step="0.5"
                 value="${data.balance}" required class="field" /></div>
        <div><label class="label">طريقة الاستلام</label>
          <select name="method" class="field"><option value="bank">تحويل بنكي</option><option value="wallet">محفظة إلكترونية</option></select></div>
        <div><label class="label">تفاصيل الحساب</label>
          <textarea name="details" rows="3" required class="field" placeholder="اسم البنك، رقم الآيبان، اسم صاحب الحساب"></textarea></div>
        <button class="btn btn-primary w-full">إرسال الطلب</button></form>`,
    });
    dialog.el.querySelector('#payoutForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const values = Object.fromEntries(new FormData(e.target));
        await api.post('/instructor/payouts', { ...values, amount: Number(values.amount) });
        dialog.close(); toast('أُرسل طلب السحب 🏦', 'success');
        earnings({ view });
      } catch (err) { toast(err.message, 'error', 6000); }
    });
  });
}

/* ============================ الكوبونات ============================ */
export async function coupons({ view }) {
  view.innerHTML = shell('الكوبونات', '', spinner());
  const data = await api.get('/coupons');

  view.innerHTML = shell('كوبونات الخصم', 'اصنع عروضاً لزيادة مبيعاتك', `
    <button id="newCoupon" class="btn btn-primary mb-5">➕ كوبون جديد</button>
    ${data.data.length ? `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      ${data.data.map(coupon => `
        <div class="card p-4 ${coupon.active ? '' : 'opacity-60'}">
          <div class="flex justify-between items-start">
            <p class="font-mono font-extrabold text-lg text-brand-700">${esc(coupon.code)}</p>
            ${coupon.active ? '<span class="badge bg-brand-100 text-brand-700">نشط</span>'
              : '<span class="badge bg-slate-200 text-slate-600">معطّل</span>'}
          </div>
          <p class="text-2xl font-extrabold my-2">${coupon.type === 'percent' ? `${coupon.value}٪` : money(coupon.value)}</p>
          <p class="text-xs text-slate-500">استُخدم ${coupon.used_count}${coupon.max_uses ? ` من ${coupon.max_uses}` : ''} مرة</p>
          ${coupon.expires_at ? `<p class="text-xs text-slate-400">ينتهي ${formatDate(coupon.expires_at)}</p>` : ''}
          <div class="flex gap-2 mt-3">
            <button data-copy="${esc(coupon.code)}" class="btn btn-ghost btn-sm flex-1">📋 نسخ</button>
            ${coupon.active ? `<button data-disable="${coupon.id}" class="btn btn-ghost btn-sm text-rose-600">تعطيل</button>` : ''}
          </div>
        </div>`).join('')}</div>`
      : emptyState('🎟', 'لا كوبونات بعد', 'أنشئ كوبون خصم لتشجيع الشراء.')}`);

  document.getElementById('newCoupon').addEventListener('click', () => {
    const dialog = modal({
      title: 'كوبون خصم جديد',
      body: `<form id="couponForm" class="space-y-3">
        <div><label class="label">الرمز *</label>
          <input name="code" required minlength="3" class="field font-mono uppercase" placeholder="SUMMER25" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">النوع</label>
            <select name="type" class="field"><option value="percent">نسبة ٪</option><option value="fixed">مبلغ ثابت</option></select></div>
          <div><label class="label">القيمة</label><input name="value" type="number" min="1" value="20" required class="field" /></div>
          <div><label class="label">حد الاستخدام</label><input name="max_uses" type="number" min="1" class="field" placeholder="بلا حد" /></div>
          <div><label class="label">أقل مبلغ</label><input name="min_amount" type="number" min="0" step="0.5" value="0" class="field" /></div>
        </div>
        <div><label class="label">تاريخ الانتهاء</label><input name="expires_at" type="date" class="field" /></div>
        <button class="btn btn-primary w-full">إنشاء الكوبون</button></form>`,
    });
    dialog.el.querySelector('#couponForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.target));
      try {
        await api.post('/coupons', {
          code: values.code, type: values.type, value: Number(values.value),
          max_uses: values.max_uses ? Number(values.max_uses) : null,
          min_amount: Number(values.min_amount || 0),
          expires_at: values.expires_at ? new Date(values.expires_at).toISOString() : null,
        });
        dialog.close(); toast('أُنشئ الكوبون 🎟', 'success');
        coupons({ view });
      } catch (err) { toast(err.message, 'error', 6000); }
    });
  });

  view.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(btn.dataset.copy);
    toast('نُسخ الرمز', 'success');
  }));

  view.querySelectorAll('[data-disable]').forEach(btn => btn.addEventListener('click', async () => {
    await api.delete(`/coupons/${btn.dataset.disable}`);
    toast('عُطّل الكوبون', 'info');
    coupons({ view });
  }));
}
