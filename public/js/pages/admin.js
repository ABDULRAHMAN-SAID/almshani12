import { api } from '../api.js';
import {
  esc, money, spinner, section, pageHeader, emptyState, errorState, toast,
  formatDate, fromNow, confirmDialog, modal, avatar,
} from '../ui.js';

const NAV = [
  ['#/admin', '📊 نظرة عامة'],
  ['#/admin/users', '👥 المستخدمون'],
  ['#/admin/instructors', '🎤 المعلّمون'],
  ['#/admin/courses', '🎬 الدورات'],
  ['#/admin/summaries', '📖 الملخّصات'],
  ['#/admin/orders', '🧾 الطلبات'],
  ['#/admin/payouts', '🏦 السحوبات'],
  ['#/admin/messages', '✉️ الرسائل'],
  ['#/admin/settings', '⚙️ الإعدادات'],
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

/* ============================ نظرة عامة ============================ */
export async function overview({ view }) {
  view.innerHTML = shell('لوحة الإدارة', '', spinner());
  let data;
  try { data = await api.get('/admin/overview'); }
  catch (err) { view.innerHTML = errorState(err.message); return; }

  const s = data.stats;
  const card = (icon, value, label, href, alert = false) => `
    <a href="${href || '#/admin'}" class="card p-4 text-center card-hover ${alert && value > 0 ? 'border-2 border-amber-400 bg-amber-50' : ''}">
      <div class="text-2xl mb-1">${icon}</div>
      <div class="text-xl font-extrabold font-display">${value}</div>
      <div class="text-xs text-slate-500">${label}</div>
    </a>`;

  view.innerHTML = shell('لوحة الإدارة', 'كل ما يجري في المنصّة', `
    ${(s.pendingCourses + s.pendingSummaries + s.pendingInstructors + s.pendingPayouts + s.pendingManualOrders) > 0 ? `
      <div class="card p-4 mb-6 border-r-4 border-r-amber-500">
        <h2 class="font-bold font-display mb-2">⚠️ مهام بانتظارك</h2>
        <div class="flex flex-wrap gap-2 text-sm">
          ${s.pendingInstructors ? `<a href="#/admin/instructors" class="badge bg-amber-100 text-amber-800">${s.pendingInstructors} طلب معلّم</a>` : ''}
          ${s.pendingCourses ? `<a href="#/admin/courses" class="badge bg-amber-100 text-amber-800">${s.pendingCourses} دورة للمراجعة</a>` : ''}
          ${s.pendingSummaries ? `<a href="#/admin/summaries" class="badge bg-amber-100 text-amber-800">${s.pendingSummaries} ملخّص للمراجعة</a>` : ''}
          ${s.pendingPayouts ? `<a href="#/admin/payouts" class="badge bg-amber-100 text-amber-800">${s.pendingPayouts} طلب سحب</a>` : ''}
          ${s.pendingManualOrders ? `<a href="#/admin/orders?status=pending" class="badge bg-amber-100 text-amber-800">${s.pendingManualOrders} تحويل بنكي</a>` : ''}
        </div>
      </div>` : ''}

    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
      ${card('👥', s.users, 'مستخدم', '#/admin/users')}
      ${card('🎤', s.instructors, 'معلّم', '#/admin/instructors')}
      ${card('🎬', s.courses, 'دورة', '#/admin/courses')}
      ${card('📖', s.summaries, 'ملخّص', '#/admin/summaries')}
      ${card('🔴', s.liveSessions, 'حصة', '#/live')}
      ${card('🎓', s.enrollments, 'تسجيل')}
      ${card('🧾', s.orders, 'طلب مدفوع', '#/admin/orders')}
      ${card('⭐', s.activeSubscriptions, 'اشتراك فعّال')}
      ${card('💵', money(s.grossRevenue), 'إجمالي المبيعات')}
      ${card('🏛', money(s.platformRevenue), 'أرباح المنصّة')}
    </div>

    <div class="grid lg:grid-cols-2 gap-6">
      <div class="card p-5">
        <h2 class="font-bold font-display mb-4">📈 الإيرادات الشهرية</h2>
        ${data.revenueByMonth.length ? `
          <div class="flex items-end gap-2 h-40 justify-start">
            ${(() => {
              const max = Math.max(...data.revenueByMonth.map(m => m.revenue), 1);
              return [...data.revenueByMonth].reverse().map(m => `
                <div class="flex-1 h-full flex flex-col items-center justify-end gap-1 group max-w-16">
                  <span class="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100">${money(m.revenue)}</span>
                  <div class="w-full bg-indigo-500 rounded-t-lg" style="height:${Math.max(6, (m.revenue / max) * 92)}%"></div>
                  <span class="text-[10px] text-slate-400">${m.month.slice(5)}</span>
                </div>`).join('');
            })()}
          </div>` : '<p class="text-slate-500 text-sm">لا مبيعات بعد.</p>'}
      </div>

      <div class="card p-5">
        <h2 class="font-bold font-display mb-4">🧾 آخر الطلبات</h2>
        <div class="space-y-2">
          ${data.recentOrders.slice(0, 8).map(order => `
            <div class="flex justify-between items-center py-1.5 border-b last:border-0 text-sm">
              <div class="min-w-0"><p class="font-mono text-xs">${esc(order.number)}</p>
                <p class="text-xs text-slate-500 truncate">${esc(order.user_name)} • ${fromNow(order.created_at)}</p></div>
              <div class="text-left shrink-0"><p class="font-bold">${money(order.total)}</p>
                <p class="text-xs ${order.status === 'paid' ? 'text-brand-600' : 'text-slate-400'}">${order.status}</p></div>
            </div>`).join('') || '<p class="text-slate-500 text-sm">لا طلبات.</p>'}
        </div>
      </div>

      <div class="card p-5">
        <h2 class="font-bold font-display mb-4">🏆 أعلى الدورات إيراداً</h2>
        ${data.topCourses.map((course, i) => `
          <div class="flex justify-between items-center py-2 border-b last:border-0 text-sm">
            <span class="truncate">${i + 1}. ${esc(course.title)}</span>
            <span class="font-bold shrink-0 mr-2">${money(course.revenue)}</span>
          </div>`).join('') || '<p class="text-slate-500 text-sm">لا بيانات.</p>'}
      </div>

      <div class="card p-5">
        <h2 class="font-bold font-display mb-4">📚 أعلى الملخّصات مبيعاً</h2>
        ${data.topSummaries.map((summary, i) => `
          <div class="flex justify-between items-center py-2 border-b last:border-0 text-sm">
            <span class="truncate">${i + 1}. ${esc(summary.title)}</span>
            <span class="font-bold shrink-0 mr-2">${summary.sales_count} بيع</span>
          </div>`).join('') || '<p class="text-slate-500 text-sm">لا بيانات.</p>'}
      </div>
    </div>`);
}

/* ============================ المستخدمون ============================ */
export async function users({ view, query }) {
  view.innerHTML = shell('المستخدمون', '', spinner());
  const data = await api.get('/admin/users', query);

  view.innerHTML = shell('المستخدمون', `${data.meta.total} مستخدم`, `
    <form id="filters" class="card p-4 mb-5 flex gap-3 flex-wrap">
      <input name="search" value="${esc(query.search || '')}" placeholder="ابحث بالاسم أو البريد" class="field flex-1 min-w-48" />
      <select name="role" class="field w-40">
        <option value="">كل الأدوار</option>
        ${[['student', 'طالب'], ['instructor', 'معلّم'], ['admin', 'مدير']]
          .map(([v, l]) => `<option value="${v}" ${query.role === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm">بحث</button>
    </form>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-right text-slate-600">
          <tr><th class="p-3">الاسم</th><th class="p-3">البريد</th><th class="p-3">الدور</th>
              <th class="p-3">الرصيد</th><th class="p-3">الحالة</th><th class="p-3">إجراءات</th></tr>
        </thead>
        <tbody>
          ${data.data.map(user => `
            <tr class="border-t">
              <td class="p-3 font-semibold">${esc(user.name)}</td>
              <td class="p-3 text-xs text-slate-500">${esc(user.email)}</td>
              <td class="p-3">${{ student: 'طالب', instructor: 'معلّم', admin: '🛡 مدير' }[user.role]}</td>
              <td class="p-3 tabular-nums">${money(user.wallet_balance)}</td>
              <td class="p-3">${user.status === 'active'
                ? '<span class="badge bg-brand-100 text-brand-700">نشط</span>'
                : '<span class="badge bg-rose-100 text-rose-700">موقوف</span>'}</td>
              <td class="p-3 whitespace-nowrap">
                <button data-role="${user.id}" data-current="${user.role}" class="btn btn-ghost btn-sm">الدور</button>
                <button data-wallet="${user.id}" class="btn btn-ghost btn-sm">💰</button>
                <button data-status="${user.id}" data-value="${user.status === 'active' ? 'suspended' : 'active'}"
                        class="btn btn-ghost btn-sm ${user.status === 'active' ? 'text-rose-600' : 'text-brand-600'}">
                  ${user.status === 'active' ? 'إيقاف' : 'تفعيل'}</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);

  document.getElementById('filters').addEventListener('submit', (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(e.target)) if (v) params.set(k, v);
    location.hash = `#/admin/users?${params}`;
  });

  view.querySelectorAll('[data-role]').forEach(btn => btn.addEventListener('click', () => {
    const dialog = modal({
      title: 'تغيير دور المستخدم',
      body: `<form id="roleForm" class="space-y-3">
        <select name="role" class="field">
          ${[['student', 'طالب'], ['instructor', 'معلّم (يُعتمد تلقائياً)'], ['admin', 'مدير']]
            .map(([v, l]) => `<option value="${v}" ${btn.dataset.current === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn btn-primary w-full">حفظ</button></form>`,
    });
    dialog.el.querySelector('#roleForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.patch(`/admin/users/${btn.dataset.role}`, { role: e.target.role.value });
        dialog.close(); toast('حُدّث الدور ✅', 'success'); users({ view, query });
      } catch (err) { toast(err.message, 'error'); }
    });
  }));

  view.querySelectorAll('[data-status]').forEach(btn => btn.addEventListener('click', async () => {
    const suspending = btn.dataset.value === 'suspended';
    if (!await confirmDialog(suspending ? 'إيقاف هذا الحساب؟ ستُنهى جلساته.' : 'إعادة تفعيل الحساب؟')) return;
    await api.patch(`/admin/users/${btn.dataset.status}`, { status: btn.dataset.value });
    toast('حُدّثت الحالة', 'success'); users({ view, query });
  }));

  view.querySelectorAll('[data-wallet]').forEach(btn => btn.addEventListener('click', () => {
    const dialog = modal({
      title: 'تسوية رصيد',
      body: `<form id="walletForm" class="space-y-3">
        <div><label class="label">المبلغ (موجب للإضافة، سالب للخصم)</label>
          <input name="amount" type="number" step="0.5" required class="field" /></div>
        <div><label class="label">السبب</label><input name="note" class="field" /></div>
        <button class="btn btn-primary w-full">تنفيذ</button></form>`,
    });
    dialog.el.querySelector('#walletForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post(`/admin/users/${btn.dataset.wallet}/wallet`, {
          amount: Number(e.target.amount.value), note: e.target.note.value,
        });
        dialog.close(); toast('نُفّذت التسوية 💰', 'success'); users({ view, query });
      } catch (err) { toast(err.message, 'error'); }
    });
  }));
}

/* ============================ المعلّمون ============================ */
export async function instructors({ view }) {
  view.innerHTML = shell('المعلّمون', '', spinner());
  const data = await api.get('/admin/instructors');

  view.innerHTML = shell('اعتماد المعلّمين', `${data.data.filter(i => !i.approved).length} طلب معلّق`, `
    <div class="space-y-3">
      ${data.data.map(instructor => `
        <div class="card p-4 flex items-center gap-4 flex-wrap ${instructor.approved ? '' : 'border-r-4 border-r-amber-500'}">
          <div class="flex-1 min-w-52">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-bold">${esc(instructor.name)}</h3>
              ${instructor.approved ? '<span class="badge bg-brand-100 text-brand-700">معتمد</span>'
                : '<span class="badge bg-amber-100 text-amber-700">قيد المراجعة</span>'}
            </div>
            <p class="text-xs text-slate-500">${esc(instructor.email)} • ${esc(instructor.title || '')} • ${esc(instructor.specialty || '')}</p>
            <p class="text-xs text-slate-400">خبرة ${instructor.years_exp || 0} سنة • عمولة ${Math.round((instructor.commission_rate || 0.2) * 100)}٪ •
              رصيد ${money(instructor.balance || 0)}</p>
            ${instructor.headline ? `<p class="text-sm text-slate-600 mt-1">${esc(instructor.headline)}</p>` : ''}
          </div>
          <div class="flex gap-2">
            <a href="#/instructors/${instructor.user_id}" class="btn btn-ghost btn-sm">👁 الملف</a>
            ${instructor.approved
              ? `<button data-revoke="${instructor.user_id}" class="btn btn-ghost btn-sm text-rose-600">سحب الاعتماد</button>`
              : `<button data-approve="${instructor.user_id}" class="btn btn-primary btn-sm">✅ اعتماد</button>`}
          </div>
        </div>`).join('') || emptyState('🎤', 'لا معلّمين بعد', '')}
    </div>`);

  view.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', async () => {
    await api.post(`/admin/instructors/${btn.dataset.approve}/approve`, { approved: true });
    toast('اعتُمد المعلّم ✅', 'success'); instructors({ view });
  }));

  view.querySelectorAll('[data-revoke]').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDialog('سحب اعتماد هذا المعلّم؟ لن يستطيع نشر محتوى جديد.')) return;
    await api.post(`/admin/instructors/${btn.dataset.revoke}/approve`, { approved: false });
    toast('سُحب الاعتماد', 'info'); instructors({ view });
  }));
}

/* ============================ مراجعة المحتوى ============================ */
const moderationPage = (kind) => async ({ view, query }) => {
  const status = query.status || 'pending';
  const isCourse = kind === 'courses';
  const title = isCourse ? 'مراجعة الدورات' : 'مراجعة الملخّصات';

  view.innerHTML = shell(title, '', spinner());
  const data = await api.get(`/admin/${kind}`, { status });

  const statusTabs = ['pending', 'published', 'draft', 'rejected', 'all'].map(value => `
    <a href="#/admin/${kind}?status=${value}" class="btn btn-sm ${status === value ? 'btn-primary' : 'btn-ghost'}">
      ${{ pending: 'قيد المراجعة', published: 'منشور', draft: 'مسوّدات', rejected: 'مرفوض', all: 'الكل' }[value]}</a>`).join('');

  view.innerHTML = shell(title, `${data.data.length} عنصر`, `
    <div class="flex gap-2 mb-5 flex-wrap">${statusTabs}</div>
    <div class="space-y-3">
      ${data.data.map(item => `
        <div class="card p-4 flex items-center gap-4 flex-wrap">
          <div class="flex-1 min-w-52">
            <h3 class="font-bold">${esc(item.title)}</h3>
            <p class="text-xs text-slate-500">
              ${isCourse
                ? `${esc(item.instructor_name)} • ${item.lessons_count} درس`
                : `${esc(item.author_name)} • «${esc(item.book_title)}» • ${item.content_length || 0} حرف`}
              • ${item.price === 0 ? 'مجاني' : money(item.price)} • ${fromNow(item.created_at)}
            </p>
          </div>
          <div class="flex gap-2 flex-wrap">
            ${isCourse && item.slug ? `<a href="#/courses/${esc(item.slug)}" class="btn btn-ghost btn-sm">👁</a>` : ''}
            ${item.status !== 'published'
              ? `<button data-action="publish" data-id="${item.id}" class="btn btn-primary btn-sm">✅ نشر</button>` : ''}
            ${item.status !== 'rejected'
              ? `<button data-action="reject" data-id="${item.id}" class="btn btn-ghost btn-sm text-rose-600">❌ رفض</button>` : ''}
            ${item.status === 'published'
              ? `<button data-action="feature" data-id="${item.id}" class="btn btn-amber btn-sm">⭐ تمييز</button>` : ''}
          </div>
        </div>`).join('') || emptyState('📭', 'لا عناصر في هذه الحالة', '')}
    </div>`);

  view.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', async () => {
    const action = btn.dataset.action;
    let reason = null;
    if (action === 'reject') {
      reason = prompt('سبب الرفض (سيصل للمعلّم):');
      if (reason === null) return;
    }
    try {
      await api.post(`/admin/${kind}/${btn.dataset.id}/moderate`, { action, reason });
      toast('نُفّذ الإجراء ✅', 'success');
      moderationPage(kind)({ view, query });
    } catch (err) { toast(err.message, 'error'); }
  }));
};

export const courses = moderationPage('courses');
export const summaries = moderationPage('summaries');

/* ============================ الطلبات ============================ */
export async function orders({ view, query }) {
  view.innerHTML = shell('الطلبات', '', spinner());
  const data = await api.get('/admin/orders', query);

  view.innerHTML = shell('الطلبات', `${data.meta.total} طلب`, `
    <div class="flex gap-2 mb-5 flex-wrap">
      ${['', 'paid', 'pending', 'failed', 'refunded'].map(value => `
        <a href="#/admin/orders${value ? `?status=${value}` : ''}" class="btn btn-sm ${(query.status || '') === value ? 'btn-primary' : 'btn-ghost'}">
          ${{ '': 'الكل', paid: 'مدفوع', pending: 'معلّق', failed: 'فاشل', refunded: 'مُسترجع' }[value]}</a>`).join('')}
    </div>

    <div class="space-y-3">
      ${data.data.map(order => `
        <div class="card p-4">
          <div class="flex items-center gap-3 flex-wrap">
            <div class="flex-1 min-w-52">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-mono font-bold text-sm">${esc(order.number)}</span>
                <span class="badge ${{ paid: 'bg-brand-100 text-brand-700', pending: 'bg-amber-100 text-amber-700',
                  failed: 'bg-rose-100 text-rose-700', refunded: 'bg-slate-200 text-slate-700',
                  cancelled: 'bg-slate-200 text-slate-600' }[order.status]}">${order.status}</span>
                ${order.provider ? `<span class="badge bg-slate-100 text-slate-600">${esc(order.provider)}</span>` : ''}
              </div>
              <p class="text-xs text-slate-500 mt-1">${esc(order.user_name)} (${esc(order.user_email)}) • ${formatDate(order.created_at, true)}</p>
              <p class="text-xs text-slate-600 mt-1">${order.items.map(i => esc(i.title)).join('، ')}</p>
            </div>
            <div class="text-left">
              <p class="font-extrabold">${money(order.total)}</p>
              ${order.discount > 0 ? `<p class="text-xs text-brand-600">خصم ${money(order.discount)}</p>` : ''}
            </div>
            <div class="flex gap-2">
              ${order.status === 'pending' ? `<button data-approve="${order.id}" class="btn btn-primary btn-sm">✅ اعتماد الدفع</button>` : ''}
              ${order.status === 'paid' ? `<button data-refund="${order.id}" class="btn btn-ghost btn-sm text-rose-600">💸 استرجاع</button>` : ''}
            </div>
          </div>
        </div>`).join('') || emptyState('🧾', 'لا طلبات', '')}
    </div>`);

  view.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDialog('اعتماد هذا الطلب؟ سيُفعّل المحتوى للمشتري وتُقيَّد أرباح المعلّم.')) return;
    try {
      await api.post(`/admin/orders/${btn.dataset.approve}/approve`);
      toast('اعتُمد الطلب ✅', 'success'); orders({ view, query });
    } catch (err) { toast(err.message, 'error'); }
  }));

  view.querySelectorAll('[data-refund]').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDialog('استرجاع كامل المبلغ؟ ستُسحب صلاحيات الوصول ويُعاد المبلغ لمحفظة المشتري.')) return;
    try {
      await api.post(`/admin/orders/${btn.dataset.refund}/refund`, { reason: 'استرجاع إداري', toWallet: true });
      toast('تم الاسترجاع 💸', 'success'); orders({ view, query });
    } catch (err) { toast(err.message, 'error'); }
  }));
}

/* ============================ السحوبات ============================ */
export async function payouts({ view }) {
  view.innerHTML = shell('السحوبات', '', spinner());
  const data = await api.get('/admin/payouts');

  view.innerHTML = shell('طلبات سحب الأرباح', `${data.data.filter(p => p.status === 'pending').length} طلب معلّق`, `
    <div class="space-y-3">
      ${data.data.map(payout => `
        <div class="card p-4 flex items-center gap-4 flex-wrap ${payout.status === 'pending' ? 'border-r-4 border-r-amber-500' : ''}">
          <div class="flex-1 min-w-52">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-bold">${esc(payout.instructor_name)}</h3>
              <span class="badge ${{ pending: 'bg-amber-100 text-amber-700', approved: 'bg-sky-100 text-sky-700',
                paid: 'bg-brand-100 text-brand-700', rejected: 'bg-rose-100 text-rose-700' }[payout.status]}">${payout.status}</span>
            </div>
            <p class="text-xs text-slate-500">${esc(payout.email)} • رصيده الحالي ${money(payout.balance || 0)} • ${formatDate(payout.requested_at, true)}</p>
            ${payout.details ? `<p class="text-xs text-slate-600 mt-1 bg-slate-50 rounded-lg p-2">${esc(payout.details)}</p>` : ''}
          </div>
          <p class="text-xl font-extrabold">${money(payout.amount)}</p>
          ${payout.status === 'pending' || payout.status === 'approved' ? `
            <div class="flex gap-2">
              <button data-pay="${payout.id}" class="btn btn-primary btn-sm">💸 تأكيد الصرف</button>
              <button data-reject="${payout.id}" class="btn btn-ghost btn-sm text-rose-600">رفض</button>
            </div>` : ''}
        </div>`).join('') || emptyState('🏦', 'لا طلبات سحب', '')}
    </div>`);

  view.querySelectorAll('[data-pay]').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDialog('تأكيد صرف المبلغ؟ سيُخصم من رصيد المعلّم بعد تحويلك الفعلي.')) return;
    try {
      await api.post(`/admin/payouts/${btn.dataset.pay}/process`, { action: 'paid', note: 'تم التحويل' });
      toast('سُجّل الصرف 💸', 'success'); payouts({ view });
    } catch (err) { toast(err.message, 'error'); }
  }));

  view.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', async () => {
    const note = prompt('سبب الرفض:');
    if (note === null) return;
    await api.post(`/admin/payouts/${btn.dataset.reject}/process`, { action: 'reject', note });
    toast('رُفض الطلب', 'info'); payouts({ view });
  }));
}

/* ============================ الرسائل ============================ */
export async function messages({ view }) {
  view.innerHTML = shell('الرسائل', '', spinner());
  const data = await api.get('/admin/messages');

  view.innerHTML = shell('رسائل الزوّار', `${data.data.length} رسالة`, `
    <div class="space-y-3">
      ${data.data.map(message => `
        <div class="card p-4">
          <div class="flex justify-between items-start flex-wrap gap-2">
            <div>
              <p class="font-bold">${esc(message.name)} <span class="text-xs text-slate-500 font-normal">${esc(message.email)}</span></p>
              ${message.subject ? `<p class="text-sm font-semibold text-slate-700">${esc(message.subject)}</p>` : ''}
            </div>
            <span class="text-xs text-slate-400">${fromNow(message.created_at)}</span>
          </div>
          <p class="text-sm text-slate-600 mt-2 leading-relaxed">${esc(message.body)}</p>
          <a href="mailto:${esc(message.email)}" class="btn btn-ghost btn-sm mt-3">✉️ ردّ بالبريد</a>
        </div>`).join('') || emptyState('✉️', 'لا رسائل', '')}
    </div>`);
}

/* ============================ الإعدادات ============================ */
export async function settings({ view }) {
  view.innerHTML = shell('الإعدادات', '', spinner());
  const data = await api.get('/admin/settings');
  const s = data.settings;

  view.innerHTML = shell('إعدادات المنصّة', '', `
    <div class="grid lg:grid-cols-2 gap-6">
      <div class="card p-6">
        <h2 class="font-bold font-display mb-4">محتوى الواجهة</h2>
        <form id="settingsForm" class="space-y-4">
          <div><label class="label">عنوان الصفحة الرئيسية</label>
            <input name="hero_title" value="${esc(s.hero_title || '')}" class="field" /></div>
          <div><label class="label">النصّ التعريفي</label>
            <textarea name="hero_subtitle" rows="2" class="field">${esc(s.hero_subtitle || '')}</textarea></div>
          <div><label class="label">نبذة عن المنصّة (تذييل الصفحة)</label>
            <textarea name="about" rows="3" class="field">${esc(s.about || '')}</textarea></div>
          <div><label class="label">رقم واتساب الدعم</label>
            <input name="support_whatsapp" value="${esc(s.support_whatsapp || '')}" class="field" /></div>
          <button class="btn btn-primary">حفظ الإعدادات</button>
        </form>
      </div>

      <div class="space-y-6">
        <div class="card p-6">
          <h2 class="font-bold font-display mb-4">الإعدادات المالية</h2>
          <dl class="space-y-2 text-sm">
            <div class="flex justify-between"><dt class="text-slate-500">العملة</dt><dd class="font-bold">${esc(data.config.currency)}</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">عمولة المنصّة</dt><dd class="font-bold">${Math.round(data.config.commissionRate * 100)}٪</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">الضريبة</dt><dd class="font-bold">${Math.round(data.config.taxRate * 100)}٪</dd></div>
            <div class="flex justify-between"><dt class="text-slate-500">بوابات الدفع</dt><dd class="font-bold">${data.config.providers.join('، ')}</dd></div>
          </dl>
          <p class="help mt-3">تُضبط هذه القيم من ملف <span class="font-mono">.env</span> ثم يُعاد تشغيل الخادم.</p>
        </div>

        <div class="card p-6">
          <h2 class="font-bold font-display mb-4">إضافة تصنيف</h2>
          <form id="categoryForm" class="flex gap-2">
            <input name="name" required placeholder="اسم التصنيف" class="field flex-1" />
            <input name="icon" placeholder="🎯" maxlength="4" class="field w-20 text-center" />
            <button class="btn btn-primary">إضافة</button>
          </form>
        </div>

        <div class="card p-6">
          <h2 class="font-bold font-display mb-4">سجلّ العمليات</h2>
          <button id="auditBtn" class="btn btn-ghost btn-sm">📜 عرض آخر ٢٠٠ عملية</button>
        </div>
      </div>
    </div>`);

  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.put('/admin/settings', Object.fromEntries(new FormData(e.target)));
      toast('حُفظت الإعدادات ✅ — حدّث الصفحة لرؤية الأثر', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('categoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin/categories', Object.fromEntries(new FormData(e.target)));
      e.target.reset(); toast('أُضيف التصنيف ✅', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('auditBtn').addEventListener('click', async () => {
    const logs = await api.get('/admin/audit');
    modal({
      title: 'سجلّ العمليات', size: 'max-w-3xl',
      body: `<div class="space-y-1 text-sm max-h-96 overflow-auto">
        ${logs.data.map(log => `
          <div class="flex gap-2 py-1.5 border-b last:border-0">
            <span class="text-xs text-slate-400 w-32 shrink-0">${fromNow(log.created_at)}</span>
            <span class="font-mono text-xs">${esc(log.action)}</span>
            <span class="text-slate-500 text-xs">${esc(log.user_name || '')} ${log.entity ? `→ ${esc(log.entity)}#${log.entity_id}` : ''}</span>
          </div>`).join('') || '<p class="text-slate-500">لا عمليات مسجّلة.</p>'}
      </div>`,
    });
  });
}
