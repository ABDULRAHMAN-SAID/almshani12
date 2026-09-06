import { bootstrap, state, subscribe, logout, isInstructor, isAdmin } from './store.js';
import { route, setNotFound, startRouter, navigate, parseHash } from './router.js';
import { esc, toast, emptyState, avatar } from './ui.js';

/* ============================ الهيكل العام ============================ */

const NAV = [
  { href: '#/courses', label: 'الدورات', icon: '🎬' },
  { href: '#/live', label: 'الحصص المباشرة', icon: '🔴' },
  { href: '#/summaries', label: 'ملخّصات الكتب', icon: '📖' },
  { href: '#/plans', label: 'الاشتراكات', icon: '⭐' },
];

function renderHeader() {
  const { user, unread, cartCount } = state;
  const currentPath = parseHash().path;
  const isActive = (href) => currentPath.startsWith(href.slice(1)) ? 'text-brand-700 bg-brand-50' : 'text-slate-600 hover:text-brand-700 hover:bg-slate-50';

  document.getElementById('header').innerHTML = `
    <header class="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex items-center gap-3 h-16">
          <a href="#/" class="flex items-center gap-2 shrink-0">
            <span class="w-9 h-9 rounded-xl bg-gradient-to-bl from-brand-500 to-brand-700 grid place-items-center text-white text-lg">🎓</span>
            <span class="font-extrabold text-lg font-display text-slate-900 hidden sm:block">${esc(state.config?.platform?.name || 'منصّة')}</span>
          </a>

          <nav class="hidden lg:flex items-center gap-1 mr-2">
            ${NAV.map(item => `<a href="${item.href}" class="px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${isActive(item.href)}">${item.icon} ${item.label}</a>`).join('')}
          </nav>

          <form id="searchForm" class="flex-1 max-w-md hidden md:block">
            <input name="q" type="search" placeholder="ابحث عن دورة، كتاب، أو معلّم..."
                   class="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm bg-slate-50 focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition" />
          </form>

          <div class="flex items-center gap-1.5 mr-auto">
            <a href="#/cart" class="relative p-2 rounded-lg hover:bg-slate-100" title="السلة" aria-label="السلة">
              🛒 ${cartCount > 0 ? `<span class="absolute -top-0.5 -left-0.5 bg-brand-600 text-white text-[10px] rounded-full w-5 h-5 grid place-items-center font-bold">${cartCount}</span>` : ''}
            </a>
            ${user ? `
              <a href="#/notifications" class="relative p-2 rounded-lg hover:bg-slate-100" title="الإشعارات" aria-label="الإشعارات">
                🔔 ${unread > 0 ? `<span class="absolute -top-0.5 -left-0.5 bg-rose-500 text-white text-[10px] rounded-full w-5 h-5 grid place-items-center font-bold">${unread > 9 ? '9+' : unread}</span>` : ''}
              </a>
              <div class="relative">
                <button id="userMenuBtn" class="flex items-center gap-2 p-1 pl-2 rounded-xl hover:bg-slate-100">
                  ${avatar(user.avatar, user.name, 8)}
                  <span class="hidden sm:block text-sm font-semibold max-w-24 truncate">${esc(user.name)}</span>
                </button>
                <div id="userMenu" class="hidden absolute left-0 mt-2 w-60 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50">
                  <div class="px-4 py-2 border-b">
                    <p class="font-bold text-sm">${esc(user.name)}</p>
                    <p class="text-xs text-slate-500 truncate">${esc(user.email)}</p>
                    <p class="text-xs text-brand-700 font-semibold mt-1">💰 الرصيد: ${Number(user.wallet_balance || 0).toFixed(2)}</p>
                  </div>
                  <a href="#/dashboard" class="block px-4 py-2 text-sm hover:bg-slate-50">📊 لوحتي</a>
                  <a href="#/my-learning" class="block px-4 py-2 text-sm hover:bg-slate-50">📚 مكتبتي</a>
                  <a href="#/certificates" class="block px-4 py-2 text-sm hover:bg-slate-50">🎓 شهاداتي</a>
                  <a href="#/orders" class="block px-4 py-2 text-sm hover:bg-slate-50">🧾 طلباتي</a>
                  <a href="#/wallet" class="block px-4 py-2 text-sm hover:bg-slate-50">💰 محفظتي</a>
                  <a href="#/wishlist" class="block px-4 py-2 text-sm hover:bg-slate-50">❤️ المفضّلة</a>
                  <a href="#/profile" class="block px-4 py-2 text-sm hover:bg-slate-50">⚙️ الحساب</a>
                  ${isInstructor() ? '<div class="border-t my-1"></div><a href="#/instructor" class="block px-4 py-2 text-sm hover:bg-slate-50 font-semibold text-brand-700">🎯 لوحة المعلّم</a>' : '<div class="border-t my-1"></div><a href="#/become-instructor" class="block px-4 py-2 text-sm hover:bg-slate-50">🎤 كن معلّماً</a>'}
                  ${isAdmin() ? '<a href="#/admin" class="block px-4 py-2 text-sm hover:bg-slate-50 font-semibold text-indigo-700">🛡️ لوحة الإدارة</a>' : ''}
                  <div class="border-t my-1"></div>
                  <button id="logoutBtn" class="w-full text-right px-4 py-2 text-sm text-rose-600 hover:bg-rose-50">🚪 تسجيل الخروج</button>
                </div>
              </div>
            ` : `
              <a href="#/login" class="btn btn-ghost btn-sm">دخول</a>
              <a href="#/register" class="btn btn-primary btn-sm">إنشاء حساب</a>
            `}
            <button id="mobileMenuBtn" class="lg:hidden p-2 rounded-lg hover:bg-slate-100" aria-label="القائمة">☰</button>
          </div>
        </div>

        <div id="mobileMenu" class="hidden lg:hidden pb-3 border-t pt-2">
          ${NAV.map(item => `<a href="${item.href}" class="block px-3 py-2.5 rounded-lg text-sm font-semibold ${isActive(item.href)}">${item.icon} ${item.label}</a>`).join('')}
          <form id="searchFormMobile" class="mt-2"><input name="q" type="search" placeholder="ابحث..." class="field text-sm" /></form>
        </div>
      </div>
    </header>`;

  // القوائم المنسدلة
  const menuBtn = document.getElementById('userMenuBtn');
  const menu = document.getElementById('userMenu');
  menuBtn?.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', () => menu?.classList.add('hidden'));

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await logout(); toast('تم تسجيل الخروج', 'info');
  });
  document.getElementById('mobileMenuBtn')?.addEventListener('click', () =>
    document.getElementById('mobileMenu').classList.toggle('hidden'));

  for (const id of ['searchForm', 'searchFormMobile']) {
    document.getElementById(id)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const term = new FormData(e.target).get('q')?.trim();
      if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
    });
  }
}

function renderFooter() {
  const name = state.config?.platform?.name || 'منصّة';
  document.getElementById('footer').innerHTML = `
    <footer class="bg-slate-900 text-slate-300 mt-16 no-print">
      <div class="max-w-7xl mx-auto px-4 py-12 grid gap-8 md:grid-cols-4">
        <div>
          <div class="flex items-center gap-2 mb-3">
            <span class="w-9 h-9 rounded-xl bg-brand-600 grid place-items-center text-white">🎓</span>
            <span class="font-extrabold text-white text-lg font-display">${esc(name)}</span>
          </div>
          <p class="text-sm leading-relaxed text-slate-400">${esc(state.config?.settings?.about || state.config?.platform?.tagline || '')}</p>
        </div>
        <div>
          <h4 class="font-bold text-white mb-3">استكشف</h4>
          <ul class="space-y-2 text-sm">
            ${NAV.map(item => `<li><a href="${item.href}" class="hover:text-brand-400">${item.label}</a></li>`).join('')}
          </ul>
        </div>
        <div>
          <h4 class="font-bold text-white mb-3">المعلّمون</h4>
          <ul class="space-y-2 text-sm">
            <li><a href="#/become-instructor" class="hover:text-brand-400">انضم كمعلّم</a></li>
            <li><a href="#/instructor" class="hover:text-brand-400">لوحة المعلّم</a></li>
            <li><a href="#/verify-certificate" class="hover:text-brand-400">التحقّق من شهادة</a></li>
          </ul>
        </div>
        <div>
          <h4 class="font-bold text-white mb-3">تواصل</h4>
          <ul class="space-y-2 text-sm">
            <li><a href="#/contact" class="hover:text-brand-400">راسلنا</a></li>
            <li class="text-slate-400">${esc(state.config?.platform?.supportEmail || '')}</li>
            ${state.config?.settings?.support_whatsapp ? `<li class="text-slate-400">📱 ${esc(state.config.settings.support_whatsapp)}</li>` : ''}
          </ul>
        </div>
      </div>
      <div class="border-t border-slate-800 py-4 text-center text-xs text-slate-500">
        © ${new Date().getFullYear()} ${esc(name)} — جميع الحقوق محفوظة
      </div>
    </footer>`;
}

/* ============================ الحراسة ============================ */
const authGuard = () => (state.user ? null : `/login?next=${encodeURIComponent(location.hash.slice(1))}`);
const instructorGuard = () => (!state.user ? '/login' : isInstructor() ? null : '/become-instructor');
const adminGuard = () => (!state.user ? '/login' : isAdmin() ? null : '/');

/* ============================ تسجيل المسارات ============================ */
const lazy = (loader, name) => async (context) => {
  const module = await loader();
  return module[name](context);
};

route('/', lazy(() => import('./pages/home.js'), 'home'));
route('/search', lazy(() => import('./pages/home.js'), 'search'));
route('/contact', lazy(() => import('./pages/home.js'), 'contact'));
route('/verify-certificate', lazy(() => import('./pages/home.js'), 'verifyCertificate'));
route('/instructors/:id', lazy(() => import('./pages/home.js'), 'instructorProfile'));

route('/courses', lazy(() => import('./pages/courses.js'), 'courseList'));
route('/courses/:slug', lazy(() => import('./pages/courses.js'), 'courseDetail'));
route('/learn/:courseId', lazy(() => import('./pages/learn.js'), 'learn'), { guard: authGuard });
route('/learn/:courseId/:lessonId', lazy(() => import('./pages/learn.js'), 'learn'), { guard: authGuard });
route('/quiz/:quizId', lazy(() => import('./pages/learn.js'), 'quizPage'), { guard: authGuard });

route('/live', lazy(() => import('./pages/live.js'), 'liveList'));
route('/live/:id', lazy(() => import('./pages/live.js'), 'liveDetail'));
route('/live/:id/room', lazy(() => import('./pages/liveRoom.js'), 'liveRoom'), { guard: authGuard });

route('/summaries', lazy(() => import('./pages/summaries.js'), 'summaryList'));
route('/summaries/:slug', lazy(() => import('./pages/summaries.js'), 'summaryDetail'));
route('/read/:id', lazy(() => import('./pages/summaries.js'), 'reader'), { guard: authGuard });

route('/cart', lazy(() => import('./pages/checkout.js'), 'cart'), { guard: authGuard });
route('/checkout', lazy(() => import('./pages/checkout.js'), 'checkout'), { guard: authGuard });
route('/checkout/pay/:number', lazy(() => import('./pages/checkout.js'), 'mockPay'), { guard: authGuard });
route('/checkout/success', lazy(() => import('./pages/checkout.js'), 'success'), { guard: authGuard });
route('/checkout/cancel', lazy(() => import('./pages/checkout.js'), 'cancelled'), { guard: authGuard });
route('/orders', lazy(() => import('./pages/checkout.js'), 'orders'), { guard: authGuard });
route('/orders/:number', lazy(() => import('./pages/checkout.js'), 'orderDetail'), { guard: authGuard });
route('/plans', lazy(() => import('./pages/checkout.js'), 'plans'));
route('/wallet', lazy(() => import('./pages/checkout.js'), 'wallet'), { guard: authGuard });

route('/login', lazy(() => import('./pages/auth.js'), 'login'));
route('/register', lazy(() => import('./pages/auth.js'), 'register'));
route('/forgot', lazy(() => import('./pages/auth.js'), 'forgot'));
route('/reset', lazy(() => import('./pages/auth.js'), 'reset'));
route('/verify', lazy(() => import('./pages/auth.js'), 'verify'));
route('/become-instructor', lazy(() => import('./pages/auth.js'), 'becomeInstructor'), { guard: authGuard });

route('/dashboard', lazy(() => import('./pages/account.js'), 'dashboard'), { guard: authGuard });
route('/my-learning', lazy(() => import('./pages/account.js'), 'library'), { guard: authGuard });
route('/certificates', lazy(() => import('./pages/account.js'), 'certificates'), { guard: authGuard });
route('/notifications', lazy(() => import('./pages/account.js'), 'notifications'), { guard: authGuard });
route('/wishlist', lazy(() => import('./pages/account.js'), 'wishlist'), { guard: authGuard });
route('/notes', lazy(() => import('./pages/account.js'), 'notes'), { guard: authGuard });
route('/profile', lazy(() => import('./pages/account.js'), 'profile'), { guard: authGuard });
route('/referral', lazy(() => import('./pages/account.js'), 'referral'), { guard: authGuard });

route('/instructor', lazy(() => import('./pages/instructor.js'), 'dashboard'), { guard: instructorGuard });
route('/instructor/courses', lazy(() => import('./pages/instructor.js'), 'courses'), { guard: instructorGuard });
route('/instructor/courses/:id', lazy(() => import('./pages/instructor.js'), 'courseEditor'), { guard: instructorGuard });
route('/instructor/live', lazy(() => import('./pages/instructor.js'), 'live'), { guard: instructorGuard });
route('/instructor/summaries', lazy(() => import('./pages/instructor.js'), 'summaries'), { guard: instructorGuard });
route('/instructor/summaries/:id', lazy(() => import('./pages/instructor.js'), 'summaryEditor'), { guard: instructorGuard });
route('/instructor/students', lazy(() => import('./pages/instructor.js'), 'students'), { guard: instructorGuard });
route('/instructor/questions', lazy(() => import('./pages/instructor.js'), 'questions'), { guard: instructorGuard });
route('/instructor/earnings', lazy(() => import('./pages/instructor.js'), 'earnings'), { guard: instructorGuard });
route('/instructor/coupons', lazy(() => import('./pages/instructor.js'), 'coupons'), { guard: instructorGuard });

route('/admin', lazy(() => import('./pages/admin.js'), 'overview'), { guard: adminGuard });
route('/admin/users', lazy(() => import('./pages/admin.js'), 'users'), { guard: adminGuard });
route('/admin/instructors', lazy(() => import('./pages/admin.js'), 'instructors'), { guard: adminGuard });
route('/admin/courses', lazy(() => import('./pages/admin.js'), 'courses'), { guard: adminGuard });
route('/admin/summaries', lazy(() => import('./pages/admin.js'), 'summaries'), { guard: adminGuard });
route('/admin/orders', lazy(() => import('./pages/admin.js'), 'orders'), { guard: adminGuard });
route('/admin/payouts', lazy(() => import('./pages/admin.js'), 'payouts'), { guard: adminGuard });
route('/admin/messages', lazy(() => import('./pages/admin.js'), 'messages'), { guard: adminGuard });
route('/admin/settings', lazy(() => import('./pages/admin.js'), 'settings'), { guard: adminGuard });

setNotFound(({ view }) => {
  view.innerHTML = emptyState('🧭', 'الصفحة غير موجودة', 'ربما تغيّر الرابط أو حُذفت الصفحة.',
    '<a href="#/" class="btn btn-primary">العودة للرئيسية</a>');
});

/* ============================ الإقلاع ============================ */
subscribe(() => { renderHeader(); renderFooter(); });

window.addEventListener('app:notification', (e) => toast(e.detail.title, 'info'));

await bootstrap();
renderHeader();
renderFooter();
startRouter();
