import { api } from '../api.js';
import { state } from '../store.js';
import {
  esc, money, spinner, section, courseCard, summaryCard, liveCard, stars, avatar,
  emptyState, formatDate, pageHeader, toast, errorState, priceTag,
} from '../ui.js';

/* ============================ الصفحة الرئيسية ============================ */
export async function home({ view }) {
  view.innerHTML = spinner('نجهّز لك المحتوى...');
  let data;
  try { data = await api.get('/home'); }
  catch (err) { view.innerHTML = errorState(err.message); return; }

  const s = state.config?.settings || {};
  const stat = (value, label, icon) => `
    <div class="text-center">
      <div class="text-2xl mb-1">${icon}</div>
      <div class="text-2xl font-extrabold text-white font-display">${value}</div>
      <div class="text-xs text-brand-100">${label}</div>
    </div>`;

  const grid = (items, renderer, cols = 'sm:grid-cols-2 lg:grid-cols-4') =>
    `<div class="grid gap-5 ${cols}">${items.map(renderer).join('')}</div>`;

  const block = (title, subtitle, link, linkLabel, content) => `
    <div class="mb-12">
      <div class="flex items-end justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 class="text-2xl md:text-3xl font-extrabold font-display text-slate-900">${esc(title)}</h2>
          <p class="text-slate-500 text-sm mt-1">${esc(subtitle)}</p>
        </div>
        <a href="${link}" class="text-brand-700 font-bold text-sm hover:underline shrink-0">${esc(linkLabel)} ←</a>
      </div>
      ${content}
    </div>`;

  view.innerHTML = `
    <!-- البطل -->
    <section class="relative bg-gradient-to-bl from-brand-800 via-brand-700 to-brand-600 text-white overflow-hidden">
      <div class="absolute inset-0 opacity-10" style="background-image:radial-gradient(circle at 20% 30%, white 1px, transparent 1px);background-size:32px 32px"></div>
      <div class="relative max-w-7xl mx-auto px-4 py-16 md:py-24">
        <div class="max-w-3xl">
          <span class="badge bg-white/15 backdrop-blur mb-4">🌍 منصّة عربية — تعلّم من أي مكان</span>
          <h1 class="text-4xl md:text-6xl font-extrabold font-display leading-tight mb-4">${esc(s.hero_title || 'تعلّم بلا حدود')}</h1>
          <p class="text-lg md:text-xl text-brand-50 leading-relaxed mb-8">${esc(s.hero_subtitle || state.config?.platform?.tagline || '')}</p>
          <div class="flex flex-wrap gap-3">
            <a href="#/courses" class="btn bg-white text-brand-800 hover:bg-brand-50 font-bold">🎬 تصفّح الدورات</a>
            <a href="#/live" class="btn bg-rose-500 text-white hover:bg-rose-600 font-bold">🔴 الحصص المباشرة</a>
            <a href="#/summaries" class="btn bg-white/15 backdrop-blur text-white hover:bg-white/25 font-bold border border-white/30">📖 ملخّصات الكتب</a>
          </div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mt-14 pt-8 border-t border-white/20">
          ${stat(data.stats.courses, 'دورة منشورة', '🎬')}
          ${stat(data.stats.summaries, 'ملخّص كتاب', '📖')}
          ${stat(data.stats.instructors, 'معلّم معتمد', '👨‍🏫')}
          ${stat(data.stats.students, 'متعلّم', '🎓')}
        </div>
      </div>
    </section>

    ${section(`
      <!-- كيف تعمل المنصّة -->
      <div class="grid gap-5 md:grid-cols-3 mb-14">
        ${[
          ['🔴', 'حصص مباشرة مدفوعة', 'احجز مقعدك في حصة مع معلّم حقيقي: دردشة، رفع يد، ومسابقات تفاعلية أثناء البثّ.'],
          ['🎬', 'دورات مسجّلة', 'تعلّم بوتيرتك مع تتبّع تقدّم، اختبارات، وشهادة إتمام قابلة للتحقّق.'],
          ['📖', 'ملخّصات كتب', 'خلاصة كتاب في دقائق — نصاً وصوتاً وPDF، مع أفكار مفتاحية وخطة تطبيق.'],
        ].map(([icon, title, text]) => `
          <div class="card p-6 card-hover">
            <div class="text-4xl mb-3">${icon}</div>
            <h3 class="font-bold text-lg font-display mb-2">${title}</h3>
            <p class="text-slate-600 text-sm leading-relaxed">${text}</p>
          </div>`).join('')}
      </div>

      ${data.upcomingLive.length ? block(
        'حصص مباشرة قادمة', 'مقاعد محدودة — احجز قبل اكتمال العدد', '#/live', 'كل الحصص',
        grid(data.upcomingLive.slice(0, 4), liveCard)) : ''}

      ${data.featuredCourses.length ? block(
        'الدورات الأكثر رواجاً', 'اختارها آلاف المتعلّمين', '#/courses', 'كل الدورات',
        grid(data.featuredCourses.slice(0, 4), courseCard)) : ''}

      ${data.featuredSummaries.length ? block(
        'ملخّصات كتب مختارة', 'اقرأ خلاصة كتاب في أقل من نصف ساعة', '#/summaries', 'كل الملخّصات',
        grid(data.featuredSummaries.slice(0, 4), summaryCard)) : ''}

      ${data.topInstructors.length ? block(
        'معلّمون مميّزون', 'نخبة من المدرّبين المعتمدين', '#/courses', 'تصفّح',
        `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          ${data.topInstructors.map(instructor => `
            <a href="#/instructors/${instructor.id}" class="card p-4 flex items-center gap-4 card-hover">
              ${avatar(instructor.avatar, instructor.name, 14)}
              <div class="min-w-0">
                <h4 class="font-bold truncate">${esc(instructor.name)}</h4>
                <p class="text-xs text-slate-500 truncate">${esc(instructor.title || instructor.specialty || '')}</p>
                <div class="mt-1">${stars(instructor.rating_avg)} <span class="text-xs text-slate-400">• ${instructor.students_count} طالب</span></div>
              </div>
            </a>`).join('')}
        </div>`) : ''}

      ${data.plans.length ? `
        <div class="rounded-3xl bg-gradient-to-bl from-slate-900 to-slate-800 text-white p-8 md:p-12">
          <div class="text-center mb-8">
            <h2 class="text-3xl font-extrabold font-display mb-2">اشترك ووفّر أكثر</h2>
            <p class="text-slate-300">وصول غير محدود للمحتوى بدل شراء كل عنصر على حدة</p>
          </div>
          <div class="grid gap-5 md:grid-cols-3">
            ${data.plans.map((plan, i) => `
              <div class="rounded-2xl p-6 ${i === 1 ? 'bg-brand-600 ring-4 ring-brand-400/30 scale-[1.02]' : 'bg-white/10 backdrop-blur'}">
                ${i === 1 ? '<span class="badge bg-white text-brand-700 mb-3">الأكثر اختياراً</span>' : ''}
                <h3 class="text-xl font-bold font-display">${esc(plan.name)}</h3>
                <p class="text-3xl font-extrabold my-3">${money(plan.price)}<span class="text-sm font-normal opacity-70">/${plan.interval === 'year' ? 'سنة' : 'شهر'}</span></p>
                <ul class="space-y-2 text-sm mb-5">
                  ${(plan.features || []).map(f => `<li>✓ ${esc(f)}</li>`).join('')}
                </ul>
                <a href="#/plans" class="btn w-full ${i === 1 ? 'bg-white text-brand-700 hover:bg-brand-50' : 'bg-white/15 text-white hover:bg-white/25'}">اشترك الآن</a>
              </div>`).join('')}
          </div>
        </div>` : ''}
    `)}`;
}

/* ============================ البحث ============================ */
export async function search({ view, query }) {
  const term = query.q || '';
  view.innerHTML = pageHeader(`نتائج البحث`, `عن: ${term}`) + section(spinner());

  const results = await api.get('/search', { q: term });
  const total = results.courses.length + results.summaries.length + results.liveSessions.length + results.instructors.length;

  const group = (title, items, renderer, cols = 'sm:grid-cols-2 lg:grid-cols-4') => items.length ? `
    <div class="mb-10">
      <h2 class="text-xl font-bold font-display mb-4">${title} <span class="text-slate-400 text-sm">(${items.length})</span></h2>
      <div class="grid gap-5 ${cols}">${items.map(renderer).join('')}</div>
    </div>` : '';

  view.innerHTML = pageHeader('نتائج البحث', `عن: ${term} — ${total} نتيجة`) + section(
    total === 0
      ? emptyState('🔍', 'لا توجد نتائج', 'جرّب كلمات مختلفة أو تصفّح الأقسام.',
          '<a href="#/courses" class="btn btn-primary">تصفّح الدورات</a>')
      : group('الدورات', results.courses, courseCard) +
        group('الحصص المباشرة', results.liveSessions, liveCard) +
        group('ملخّصات الكتب', results.summaries, summaryCard) +
        group('المعلّمون', results.instructors, (instructor) => `
          <a href="#/instructors/${instructor.id}" class="card p-4 flex items-center gap-3 card-hover">
            ${avatar(instructor.avatar, instructor.name, 12)}
            <div class="min-w-0"><h4 class="font-bold truncate">${esc(instructor.name)}</h4>
            <p class="text-xs text-slate-500">${esc(instructor.specialty || '')}</p></div>
          </a>`),
  );
}

/* ============================ صفحة المعلّم ============================ */
export async function instructorProfile({ view, params }) {
  view.innerHTML = spinner();
  let data;
  try { data = await api.get(`/instructors/${params.id}`); }
  catch (err) { view.innerHTML = errorState(err.message); return; }

  const { instructor } = data;
  view.innerHTML = `
    <div class="bg-gradient-to-l from-brand-800 to-brand-600 text-white">
      <div class="max-w-7xl mx-auto px-4 py-10 flex flex-col sm:flex-row items-center gap-6 text-center sm:text-right">
        <div class="shrink-0">${avatar(instructor.avatar, instructor.name, 24)}</div>
        <div>
          <h1 class="text-3xl font-extrabold font-display">${esc(instructor.name)}</h1>
          <p class="text-brand-100 mt-1">${esc(instructor.title || '')} ${instructor.specialty ? `• ${esc(instructor.specialty)}` : ''}</p>
          <div class="flex gap-4 mt-3 text-sm justify-center sm:justify-start">
            <span>⭐ ${(instructor.rating_avg || 0).toFixed(1)} (${instructor.rating_count || 0})</span>
            <span>🎓 ${instructor.students_count || 0} طالب</span>
            ${instructor.years_exp ? `<span>💼 ${instructor.years_exp} سنة خبرة</span>` : ''}
          </div>
        </div>
      </div>
    </div>
    ${section(`
      ${instructor.bio ? `<div class="card p-6 mb-8"><h2 class="font-bold font-display mb-2">نبذة</h2><p class="text-slate-700 leading-relaxed">${esc(instructor.bio)}</p></div>` : ''}
      ${data.liveSessions.length ? `<h2 class="text-xl font-bold font-display mb-4">حصص مباشرة قادمة</h2>
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-10">${data.liveSessions.map(s => liveCard({ ...s, instructor_name: instructor.name })).join('')}</div>` : ''}
      ${data.courses.length ? `<h2 class="text-xl font-bold font-display mb-4">الدورات</h2>
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-10">${data.courses.map(c => courseCard({ ...c, instructor_name: instructor.name })).join('')}</div>` : ''}
      ${data.summaries.length ? `<h2 class="text-xl font-bold font-display mb-4">ملخّصات الكتب</h2>
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">${data.summaries.map(summaryCard).join('')}</div>` : ''}
    `)}`;
}

/* ============================ تواصل معنا ============================ */
export async function contact({ view }) {
  view.innerHTML = pageHeader('تواصل معنا', 'نسعد بأسئلتك واقتراحاتك') + section(`
    <div class="max-w-2xl mx-auto card p-6">
      <form id="contactForm" class="space-y-4">
        <div><label class="label">الاسم</label><input name="name" required minlength="2" class="field" /></div>
        <div><label class="label">البريد الإلكتروني</label><input name="email" type="email" required class="field" /></div>
        <div><label class="label">الموضوع</label><input name="subject" class="field" /></div>
        <div><label class="label">الرسالة</label><textarea name="body" required minlength="10" rows="5" class="field"></textarea></div>
        <button class="btn btn-primary w-full">إرسال</button>
      </form>
    </div>`, 'max-w-3xl');

  document.getElementById('contactForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const result = await api.post('/contact', Object.fromEntries(new FormData(e.target)));
      toast(result.message, 'success');
      e.target.reset();
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });
}

/* ============================ التحقّق من شهادة ============================ */
export async function verifyCertificate({ view, query }) {
  view.innerHTML = pageHeader('التحقّق من شهادة', 'أدخل الرقم التسلسلي للتأكد من صحة الشهادة') + section(`
    <div class="max-w-xl mx-auto">
      <form id="verifyForm" class="card p-6 flex gap-2">
        <input name="serial" value="${esc(query.serial || '')}" placeholder="CERT-XXXX-XXXX-XXXX" required
               class="field font-mono flex-1 uppercase" />
        <button class="btn btn-primary">تحقّق</button>
      </form>
      <div id="verifyResult" class="mt-6"></div>
    </div>`);

  const form = document.getElementById('verifyForm');
  const output = document.getElementById('verifyResult');

  const check = async (serial) => {
    output.innerHTML = spinner('جارٍ التحقّق...');
    try {
      const data = await api.get(`/certificates/verify/${encodeURIComponent(serial.trim().toUpperCase())}`);
      const c = data.certificate;
      output.innerHTML = `
        <div class="card p-6 border-2 border-brand-500 text-center">
          <div class="text-5xl mb-3">✅</div>
          <h3 class="text-xl font-bold font-display text-brand-800 mb-4">شهادة صحيحة وموثّقة</h3>
          <dl class="text-right space-y-2 text-sm bg-slate-50 rounded-xl p-4">
            <div class="flex justify-between"><dt class="text-slate-500">الطالب</dt><dd class="font-bold">${esc(c.student_name)}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">الدورة</dt><dd class="font-bold">${esc(c.course_title)}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">المعلّم</dt><dd>${esc(c.instructor_name)}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">تاريخ الإصدار</dt><dd>${formatDate(c.issued_at)}</dd></div>
            ${c.grade != null ? `<div class="flex justify-between"><dt class="text-slate-500">الدرجة</dt><dd class="font-bold text-brand-700">${Math.round(c.grade)}٪</dd></div>` : ''}
            <div class="flex justify-between"><dt class="text-slate-500">الرقم</dt><dd class="font-mono text-xs">${esc(c.serial)}</dd></div>
          </dl>
        </div>`;
    } catch {
      output.innerHTML = `<div class="card p-6 border-2 border-rose-300 text-center">
        <div class="text-5xl mb-3">❌</div>
        <h3 class="text-lg font-bold text-rose-700">لا توجد شهادة بهذا الرقم</h3>
        <p class="text-slate-500 text-sm mt-2">تأكّد من الرقم التسلسلي وحاول مجدداً.</p></div>`;
    }
  };

  form.addEventListener('submit', (e) => { e.preventDefault(); check(new FormData(e.target).get('serial')); });
  if (query.serial) check(query.serial);
}
