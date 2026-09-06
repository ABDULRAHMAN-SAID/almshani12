import { api } from '../api.js';
import { login as doLogin, register as doRegister, refreshUser, state } from '../store.js';
import { esc, toast, section, spinner } from '../ui.js';
import { navigate } from '../router.js';

const shell = (title, subtitle, body, footer = '') => `
  <div class="min-h-[70vh] grid place-items-center px-4 py-12">
    <div class="w-full max-w-md">
      <div class="text-center mb-6">
        <a href="#/" class="inline-flex items-center gap-2 mb-4">
          <span class="w-12 h-12 rounded-2xl bg-gradient-to-bl from-brand-500 to-brand-700 grid place-items-center text-white text-2xl">🎓</span>
        </a>
        <h1 class="text-2xl font-extrabold font-display">${esc(title)}</h1>
        <p class="text-slate-500 text-sm mt-1">${esc(subtitle)}</p>
      </div>
      <div class="card p-6">${body}</div>
      ${footer ? `<p class="text-center text-sm text-slate-600 mt-4">${footer}</p>` : ''}
    </div>
  </div>`;

/** يعرض رسالة خطأ الحقول القادمة من الخادم. */
function showError(container, err) {
  const details = err.details?.map(d => `<li>${esc(d.message)}</li>`).join('') || '';
  container.innerHTML = `
    <div class="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-4 py-3 text-sm">
      <p class="font-semibold">${esc(err.message)}</p>
      ${details ? `<ul class="list-disc pr-5 mt-1 text-xs">${details}</ul>` : ''}
    </div>`;
}

async function submitForm(form, handler) {
  const errorBox = form.querySelector('[data-error]');
  const button = form.querySelector('button[type="submit"]');
  const original = button.textContent;
  errorBox.innerHTML = '';
  button.disabled = true;
  button.textContent = 'جارٍ المعالجة...';
  try {
    await handler(Object.fromEntries(new FormData(form)));
  } catch (err) {
    showError(errorBox, err);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

/* ============================ تسجيل الدخول ============================ */
export function login({ view, query }) {
  if (state.user) return navigate(query.next || '/dashboard', { replace: true });

  view.innerHTML = shell('تسجيل الدخول', 'أهلاً بعودتك 👋', `
    <form id="form" class="space-y-4">
      <div data-error></div>
      <div><label class="label">البريد الإلكتروني</label>
        <input name="email" type="email" required autocomplete="email" class="field" placeholder="you@example.com" /></div>
      <div><label class="label">كلمة المرور</label>
        <input name="password" type="password" required autocomplete="current-password" class="field" /></div>
      <div class="flex justify-between items-center text-sm">
        <a href="#/forgot" class="text-brand-700 hover:underline">نسيت كلمة المرور؟</a>
      </div>
      <button type="submit" class="btn btn-primary w-full">دخول</button>
    </form>
    <div class="mt-5 pt-4 border-t">
      <p class="text-xs text-slate-500 mb-2 text-center">حسابات تجريبية (كلمة المرور: Passw0rd!)</p>
      <div class="grid grid-cols-3 gap-1.5 text-xs">
        <button data-demo="student@manassah.om" class="btn btn-ghost btn-sm">طالب</button>
        <button data-demo="abdulrahman@manassah.om" class="btn btn-ghost btn-sm">معلّم</button>
        <button data-demo="admin@manassah.om" class="btn btn-ghost btn-sm">مدير</button>
      </div>
    </div>`,
    `ليس لديك حساب؟ <a href="#/register" class="text-brand-700 font-bold hover:underline">أنشئ حساباً مجاناً</a>`);

  const form = document.getElementById('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(form, async (values) => {
      await doLogin(values.email, values.password);
      toast('مرحباً بك مجدداً!', 'success');
      navigate(query.next || '/dashboard');
    });
  });

  view.querySelectorAll('[data-demo]').forEach(btn => btn.addEventListener('click', () => {
    form.email.value = btn.dataset.demo;
    form.password.value = 'Passw0rd!';
    form.requestSubmit();
  }));
}

/* ============================ إنشاء حساب ============================ */
export function register({ view, query }) {
  if (state.user) return navigate('/dashboard', { replace: true });

  view.innerHTML = shell('إنشاء حساب', 'ابدأ رحلتك التعليمية اليوم', `
    <form id="form" class="space-y-4">
      <div data-error></div>
      <div><label class="label">الاسم الكامل</label><input name="name" required minlength="2" class="field" /></div>
      <div><label class="label">البريد الإلكتروني</label><input name="email" type="email" required autocomplete="email" class="field" /></div>
      <div><label class="label">رقم الجوال <span class="text-slate-400 font-normal">(اختياري)</span></label>
        <input name="phone" type="tel" class="field" placeholder="+968 ..." /></div>
      <div><label class="label">كلمة المرور</label>
        <input name="password" type="password" required minlength="8" autocomplete="new-password" class="field" />
        <p class="help">٨ أحرف على الأقل، وتحتوي على حروف وأرقام</p></div>
      <div><label class="label">نوع الحساب</label>
        <select name="role" class="field">
          <option value="student">طالب — أتعلّم</option>
          <option value="instructor">معلّم — أُدرّس وأنشر محتوى</option>
        </select>
        <p class="help">حساب المعلّم يحتاج اعتماداً من الإدارة قبل النشر</p></div>
      ${query.ref ? `<input type="hidden" name="referral" value="${esc(query.ref)}" />
        <div class="bg-brand-50 border border-brand-200 rounded-xl px-3 py-2 text-sm text-brand-800">🎁 انضممت عبر دعوة صديق</div>` : ''}
      <button type="submit" class="btn btn-primary w-full">إنشاء الحساب</button>
    </form>`,
    `لديك حساب؟ <a href="#/login" class="text-brand-700 font-bold hover:underline">سجّل الدخول</a>`);

  const form = document.getElementById('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(form, async (values) => {
      const user = await doRegister(values);
      toast(`أهلاً ${user.name}! تم إنشاء حسابك`, 'success');
      navigate(values.role === 'instructor' ? '/instructor' : '/dashboard');
    });
  });
}

/* ============================ استعادة كلمة المرور ============================ */
export function forgot({ view }) {
  view.innerHTML = shell('استعادة كلمة المرور', 'سنرسل لك رابط إعادة التعيين', `
    <form id="form" class="space-y-4">
      <div data-error></div>
      <div><label class="label">البريد الإلكتروني</label><input name="email" type="email" required class="field" /></div>
      <button type="submit" class="btn btn-primary w-full">إرسال الرابط</button>
    </form>`,
    `<a href="#/login" class="text-brand-700 hover:underline">العودة لتسجيل الدخول</a>`);

  const form = document.getElementById('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(form, async (values) => {
      const result = await api.post('/auth/forgot-password', values);
      form.innerHTML = `<div class="text-center py-6">
        <div class="text-5xl mb-3">📧</div>
        <p class="text-slate-700">${esc(result.message)}</p>
        <p class="text-xs text-slate-500 mt-3">في وضع التطوير يظهر الرابط في سجلّ الخادم.</p></div>`;
    });
  });
}

export function reset({ view, query }) {
  view.innerHTML = shell('تعيين كلمة مرور جديدة', '', `
    <form id="form" class="space-y-4">
      <div data-error></div>
      <input type="hidden" name="token" value="${esc(query.token || '')}" />
      ${!query.token ? '<div><label class="label">رمز الاستعادة</label><input name="token" required class="field font-mono" /></div>' : ''}
      <div><label class="label">كلمة المرور الجديدة</label>
        <input name="password" type="password" required minlength="8" class="field" /></div>
      <button type="submit" class="btn btn-primary w-full">حفظ كلمة المرور</button>
    </form>`);

  const form = document.getElementById('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(form, async (values) => {
      await api.post('/auth/reset-password', values);
      toast('تم تغيير كلمة المرور، يمكنك الدخول الآن', 'success');
      navigate('/login');
    });
  });
}

export async function verify({ view, query }) {
  view.innerHTML = section(spinner('جارٍ تفعيل الحساب...'));
  try {
    await api.post('/auth/verify-email', { token: query.token });
    await refreshUser();
    view.innerHTML = shell('تم التفعيل ✅', 'أصبح حسابك مفعّلاً بالكامل',
      '<a href="#/dashboard" class="btn btn-primary w-full">ابدأ التعلّم</a>');
  } catch (err) {
    view.innerHTML = shell('تعذّر التفعيل', err.message,
      '<a href="#/" class="btn btn-ghost w-full">العودة للرئيسية</a>');
  }
}

/* ============================ التقدّم كمعلّم ============================ */
export function becomeInstructor({ view }) {
  if (['instructor', 'admin'].includes(state.user?.role) && state.instructorProfile?.approved) {
    return navigate('/instructor', { replace: true });
  }
  const pending = state.instructorProfile && !state.instructorProfile.approved;

  view.innerHTML = `
    <div class="bg-gradient-to-l from-slate-900 to-brand-800 text-white">
      <div class="max-w-4xl mx-auto px-4 py-14 text-center">
        <h1 class="text-4xl font-extrabold font-display mb-3">شارك علمك واكسب دخلاً</h1>
        <p class="text-brand-100 text-lg">انشر دورات، أقم حصصاً مباشرة، وبِع ملخّصات كتبك — واحتفظ بـ ٨٠٪ من الإيراد.</p>
      </div>
    </div>
    ${section(`
      <div class="grid gap-5 md:grid-cols-3 mb-10">
        ${[['💰', '٨٠٪ من كل عملية بيع', 'عمولة المنصّة ٢٠٪ فقط، وسحب أرباحك متى بلغت الحد الأدنى.'],
           ['🛠', 'أدوات جاهزة', 'محرّر دورات، جدولة حصص، قاعة بثّ بالدردشة والمسابقات، ومحرّر ملخّصات.'],
           ['📈', 'لوحة تحليلات', 'تابع المبيعات والطلاب والتقييمات في مكان واحد.']]
          .map(([icon, title, text]) => `
            <div class="card p-6"><div class="text-4xl mb-3">${icon}</div>
              <h3 class="font-bold font-display mb-2">${title}</h3>
              <p class="text-sm text-slate-600 leading-relaxed">${text}</p></div>`).join('')}
      </div>

      <div class="max-w-2xl mx-auto card p-6">
        ${pending ? `
          <div class="text-center py-8">
            <div class="text-5xl mb-3">⏳</div>
            <h2 class="text-xl font-bold font-display mb-2">طلبك قيد المراجعة</h2>
            <p class="text-slate-600">سيصلك إشعار فور اعتماد حسابك من الإدارة.</p>
          </div>` : `
          <h2 class="text-xl font-bold font-display mb-4">قدّم طلبك الآن</h2>
          <form id="form" class="space-y-4">
            <div data-error></div>
            <div><label class="label">المسمّى المهني</label>
              <input name="title" required class="field" placeholder="مثال: مهندس برمجيات، مدرّب لغات" /></div>
            <div><label class="label">التخصّص</label>
              <input name="specialty" required class="field" placeholder="مثال: البرمجة، إدارة الأعمال" /></div>
            <div><label class="label">سنوات الخبرة</label>
              <input name="years_exp" type="number" min="0" max="60" value="1" class="field" /></div>
            <div><label class="label">نبذة تعريفية</label>
              <textarea name="headline" rows="3" class="field" placeholder="عرّف بنفسك وبما ستقدّمه للمتعلّمين"></textarea></div>
            <button type="submit" class="btn btn-primary w-full">إرسال الطلب</button>
          </form>`}
      </div>`)}`;

  const form = document.getElementById('form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(form, async (values) => {
      const result = await api.post('/auth/apply-instructor', values);
      await refreshUser();
      toast(result.message, 'success');
      navigate('/become-instructor');
    });
  });
}
