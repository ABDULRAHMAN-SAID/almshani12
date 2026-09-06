import { api } from '../api.js';
import { state, refreshUser, setState } from '../store.js';
import {
  esc, money, spinner, section, pageHeader, emptyState, errorState, toast,
  formatDate, confirmDialog, avatar, priceTag, modal,
} from '../ui.js';
import { navigate } from '../router.js';

const typeLabels = { course: '🎬 دورة', summary: '📖 ملخّص', live_session: '🔴 حصة مباشرة', bundle: '📦 حزمة', plan: '⭐ اشتراك' };

/* ============================ السلة ============================ */
export async function cart({ view }) {
  view.innerHTML = pageHeader('سلة المشتريات') + section(`<div id="cartBox">${spinner()}</div>`);
  const box = document.getElementById('cartBox');

  const render = async () => {
    const data = await api.get('/cart');
    setState({ cartCount: data.items.length });

    if (!data.items.length) {
      box.innerHTML = emptyState('🛒', 'سلتك فارغة', 'أضف دورة أو ملخّصاً أو حصة مباشرة لتبدأ.',
        '<div class="flex gap-2 justify-center flex-wrap"><a href="#/courses" class="btn btn-primary">الدورات</a><a href="#/summaries" class="btn btn-ghost">الملخّصات</a></div>');
      return;
    }

    box.innerHTML = `
      <div class="grid lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 space-y-3">
          ${data.items.map(item => `
            <div class="card p-4 flex items-center gap-4">
              <div class="w-20 h-16 rounded-xl bg-slate-100 shrink-0 overflow-hidden">
                ${item.cover ? `<img src="${esc(item.cover)}" class="w-full h-full object-cover" alt="" />`
                  : `<div class="w-full h-full grid place-items-center text-2xl">${typeLabels[item.type]?.slice(0, 2) || '📦'}</div>`}
              </div>
              <div class="flex-1 min-w-0">
                <span class="badge bg-slate-100 text-slate-600 mb-1">${typeLabels[item.type] || item.type}</span>
                <h3 class="font-bold truncate">${esc(item.title)}</h3>
                ${item.startsAt ? `<p class="text-xs text-slate-500">🗓 ${formatDate(item.startsAt, true)}</p>` : ''}
              </div>
              <div class="text-left shrink-0">
                <p class="font-extrabold">${item.price === 0 ? 'مجاناً' : money(item.price)}</p>
                <button data-remove="${item.cart_item_id}" class="text-xs text-rose-600 hover:underline mt-1">إزالة</button>
              </div>
            </div>`).join('')}
          <button id="clearCart" class="btn btn-ghost btn-sm">🗑 إفراغ السلة</button>
        </div>

        <div>
          <div class="card p-5 lg:sticky lg:top-20">
            <h2 class="font-bold font-display mb-4">ملخّص الطلب</h2>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between"><span class="text-slate-500">المجموع</span><span class="font-bold">${money(data.subtotal)}</span></div>
              ${data.tax > 0 ? `<div class="flex justify-between"><span class="text-slate-500">الضريبة</span><span>${money(data.tax)}</span></div>` : ''}
              <div class="flex justify-between text-lg pt-2 border-t"><span class="font-bold">الإجمالي</span><span class="font-extrabold text-brand-700">${money(data.total)}</span></div>
            </div>
            <a href="#/checkout" class="btn btn-primary w-full mt-4">إتمام الشراء ←</a>
            <a href="#/courses" class="btn btn-ghost w-full mt-2 text-sm">متابعة التسوّق</a>
          </div>
        </div>
      </div>`;

    box.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', async () => {
      await api.delete(`/cart/${btn.dataset.remove}`);
      toast('أُزيل العنصر', 'info');
      render();
    }));

    document.getElementById('clearCart').addEventListener('click', async () => {
      if (!await confirmDialog('هل تريد إفراغ السلة بالكامل؟')) return;
      await api.delete('/cart');
      render();
    });
  };

  try { await render(); } catch (err) { box.innerHTML = errorState(err.message); }
}

/* ============================ إتمام الشراء ============================ */
export async function checkout({ view }) {
  view.innerHTML = pageHeader('إتمام الشراء') + section(`<div id="box">${spinner()}</div>`);
  const box = document.getElementById('box');

  let cartData, methods, currentQuote, coupon = null;
  try {
    [cartData, methods] = await Promise.all([api.get('/cart'), api.get('/payment-methods')]);
  } catch (err) { box.innerHTML = errorState(err.message); return; }

  if (!cartData.items.length) {
    box.innerHTML = emptyState('🛒', 'سلتك فارغة', '', '<a href="#/courses" class="btn btn-primary">تصفّح المحتوى</a>');
    return;
  }

  const walletBalance = Number(state.user?.wallet_balance || 0);

  const render = () => {
    box.innerHTML = `
      <div class="grid lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 space-y-5">
          <div class="card p-5">
            <h2 class="font-bold font-display mb-3">العناصر (${cartData.items.length})</h2>
            <div class="space-y-2">
              ${cartData.items.map(item => `
                <div class="flex justify-between items-center py-2 border-b last:border-0 text-sm">
                  <div><span class="badge bg-slate-100 text-slate-600 ml-2">${typeLabels[item.type] || ''}</span>
                    <span class="font-semibold">${esc(item.title)}</span></div>
                  <span class="font-bold shrink-0">${money(item.price)}</span>
                </div>`).join('')}
            </div>
          </div>

          <div class="card p-5">
            <h2 class="font-bold font-display mb-3">رمز الخصم</h2>
            <form id="couponForm" class="flex gap-2">
              <input name="code" value="${esc(coupon || '')}" placeholder="أدخل رمز الخصم" class="field flex-1 uppercase font-mono" />
              <button class="btn btn-ghost">تطبيق</button>
            </form>
            <p class="help">جرّب: <button data-coupon="WELCOME20" class="text-brand-700 font-bold">WELCOME20</button> لخصم ٢٠٪</p>
          </div>

          <div class="card p-5">
            <h2 class="font-bold font-display mb-3">وسيلة الدفع</h2>
            <div class="space-y-2">
              ${methods.providers.map((provider, i) => `
                <label class="flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 border-slate-200">
                  <input type="radio" name="provider" value="${esc(provider.id)}" ${i === 0 ? 'checked' : ''}
                         class="mt-1 w-4 h-4 accent-emerald-600" />
                  <div class="flex-1">
                    <p class="font-bold text-sm">${esc(provider.label)}</p>
                    ${provider.id === 'wallet' ? `<p class="text-xs ${walletBalance >= (currentQuote?.total ?? 0) ? 'text-slate-500' : 'text-rose-600 font-bold'}">
                      رصيدك: ${money(walletBalance)} ${walletBalance < (currentQuote?.total ?? 0) ? '— غير كافٍ' : ''}</p>` : ''}
                    ${provider.id === 'mock' ? '<p class="text-xs text-slate-500">بوابة محاكاة للتجربة — لا تُخصم أموال حقيقية</p>' : ''}
                    ${provider.id === 'manual' ? `<div class="text-xs text-slate-600 mt-1 bg-slate-50 rounded-lg p-2">
                        <p>${esc(provider.instructions?.bankName || '')} — ${esc(provider.instructions?.accountName || '')}</p>
                        <p class="font-mono">${esc(provider.instructions?.iban || '')}</p>
                        <p class="text-amber-700 mt-1">يُفعّل المحتوى بعد مراجعة الإدارة للتحويل.</p></div>` : ''}
                  </div>
                </label>`).join('')}
            </div>
          </div>
        </div>

        <div>
          <div class="card p-5 lg:sticky lg:top-20">
            <h2 class="font-bold font-display mb-4">الفاتورة</h2>
            <div id="totals" class="space-y-2 text-sm">${spinner('')}</div>
            <button id="payBtn" class="btn btn-primary w-full mt-4 text-lg" disabled>ادفع الآن</button>
            <p class="text-xs text-slate-400 text-center mt-3">بالمتابعة أنت توافق على شروط الاستخدام</p>
          </div>
        </div>
      </div>`;

    wire();
    loadQuote();
  };

  const loadQuote = async () => {
    const totals = document.getElementById('totals');
    try {
      currentQuote = await api.post('/quote', { coupon });
      totals.innerHTML = `
        <div class="flex justify-between"><span class="text-slate-500">المجموع</span><span>${money(currentQuote.subtotal)}</span></div>
        ${currentQuote.discount > 0 ? `<div class="flex justify-between text-brand-700 font-bold">
          <span>خصم ${esc(currentQuote.coupon?.code || '')}</span><span>- ${money(currentQuote.discount)}</span></div>` : ''}
        ${currentQuote.tax > 0 ? `<div class="flex justify-between"><span class="text-slate-500">الضريبة</span><span>${money(currentQuote.tax)}</span></div>` : ''}
        <div class="flex justify-between text-lg pt-2 border-t"><span class="font-bold">الإجمالي</span>
          <span class="font-extrabold text-brand-700">${money(currentQuote.total)}</span></div>`;
      document.getElementById('payBtn').disabled = false;
    } catch (err) {
      totals.innerHTML = `<p class="text-rose-600 text-sm">${esc(err.message)}</p>`;
      document.getElementById('payBtn').disabled = true;
    }
  };

  const wire = () => {
    document.getElementById('couponForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      coupon = e.target.code.value.trim().toUpperCase() || null;
      await loadQuote();
      if (coupon && currentQuote?.discount > 0) toast('طُبّق الخصم ✅', 'success');
    });

    box.querySelectorAll('[data-coupon]').forEach(btn => btn.addEventListener('click', async () => {
      coupon = btn.dataset.coupon;
      document.querySelector('[name="code"]').value = coupon;
      await loadQuote();
      toast('طُبّق الخصم ✅', 'success');
    }));

    document.getElementById('payBtn').addEventListener('click', async (e) => {
      const provider = box.querySelector('[name="provider"]:checked')?.value || 'mock';
      e.target.disabled = true;
      e.target.textContent = 'جارٍ المعالجة...';

      try {
        const result = await api.post('/checkout', { coupon, provider });
        await refreshUser();

        if (result.paid) {
          navigate(`/checkout/success?order=${result.order.number}`);
        } else if (result.checkoutUrl) {
          if (result.checkoutUrl.startsWith('/#')) location.hash = result.checkoutUrl.slice(1);
          else location.href = result.checkoutUrl;
        } else if (result.awaitingReview) {
          navigate(`/orders/${result.order.number}`);
          toast('استلمنا طلبك — سيُفعّل بعد تأكيد التحويل', 'info', 6000);
        }
      } catch (err) {
        toast(err.message, 'error', 6000);
        e.target.disabled = false;
        e.target.textContent = 'ادفع الآن';
      }
    });
  };

  render();
}

/* ============================ صفحة البوابة التجريبية ============================ */
export async function mockPay({ view, params }) {
  const order = await api.get(`/orders/${params.number}`).catch(() => null);
  if (!order) { view.innerHTML = errorState('الطلب غير موجود'); return; }

  view.innerHTML = section(`
    <div class="max-w-md mx-auto">
      <div class="card overflow-hidden">
        <div class="bg-slate-900 text-white p-5 text-center">
          <p class="text-xs text-slate-400 mb-1">بوابة دفع تجريبية</p>
          <p class="text-3xl font-extrabold">${money(order.order.total)}</p>
          <p class="text-xs text-slate-400 mt-1">الطلب ${esc(order.order.number)}</p>
        </div>
        <div class="p-5 space-y-4">
          <div>
            <label class="label">رقم البطاقة</label>
            <input value="4242 4242 4242 4242" readonly class="field font-mono bg-slate-50" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">تاريخ الانتهاء</label><input value="12/30" readonly class="field bg-slate-50" /></div>
            <div><label class="label">CVC</label><input value="123" readonly class="field bg-slate-50" /></div>
          </div>
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            ⚠️ هذه محاكاة للاختبار فقط — لا تُخصم أموال حقيقية. لربط بوابة حقيقية اضبط <span class="font-mono">STRIPE_SECRET_KEY</span>.
          </div>
          <button id="payOk" class="btn btn-primary w-full">✅ محاكاة دفع ناجح</button>
          <button id="payFail" class="btn btn-ghost w-full text-rose-600">❌ محاكاة فشل الدفع</button>
        </div>
      </div>
    </div>`);

  const confirm = async (outcome) => {
    try {
      const result = await api.post('/checkout/mock/confirm', { order_number: params.number, outcome });
      await refreshUser();
      if (result.ok) navigate(`/checkout/success?order=${params.number}`);
      else { toast(result.message, 'error'); navigate('/checkout/cancel'); }
    } catch (err) { toast(err.message, 'error'); }
  };

  document.getElementById('payOk').addEventListener('click', () => confirm('success'));
  document.getElementById('payFail').addEventListener('click', () => confirm('failure'));
}

export async function success({ view, query }) {
  const data = query.order ? await api.get(`/orders/${query.order}`).catch(() => null) : null;
  view.innerHTML = section(`
    <div class="max-w-lg mx-auto text-center">
      <div class="card p-8">
        <div class="text-6xl mb-4">🎉</div>
        <h1 class="text-2xl font-extrabold font-display mb-2">تم الدفع بنجاح!</h1>
        <p class="text-slate-600 mb-6">أصبح المحتوى متاحاً في مكتبتك مباشرة.</p>
        ${data ? `<div class="bg-slate-50 rounded-xl p-4 text-right text-sm mb-6">
          <div class="flex justify-between mb-1"><span class="text-slate-500">رقم الطلب</span><span class="font-mono font-bold">${esc(data.order.number)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">المبلغ</span><span class="font-bold">${money(data.order.total)}</span></div>
          <div class="mt-3 pt-3 border-t space-y-1">
            ${data.items.map(i => `<p class="text-xs">✅ ${esc(i.title)}</p>`).join('')}
          </div></div>` : ''}
        <div class="flex gap-2 justify-center flex-wrap">
          <a href="#/my-learning" class="btn btn-primary">📚 اذهب لمكتبتي</a>
          <a href="#/orders" class="btn btn-ghost">🧾 طلباتي</a>
        </div>
      </div>
    </div>`);
}

export function cancelled({ view }) {
  view.innerHTML = section(emptyState('😔', 'لم تكتمل عملية الدفع',
    'لم يُخصم أي مبلغ. عناصر سلتك محفوظة.',
    '<div class="flex gap-2 justify-center"><a href="#/checkout" class="btn btn-primary">حاول مجدداً</a><a href="#/cart" class="btn btn-ghost">السلة</a></div>'));
}

/* ============================ الطلبات ============================ */
export async function orders({ view }) {
  view.innerHTML = pageHeader('طلباتي') + section(`<div id="box">${spinner()}</div>`);
  const result = await api.get('/orders');
  const statusBadge = {
    paid: '<span class="badge bg-brand-100 text-brand-700">✅ مدفوع</span>',
    pending: '<span class="badge bg-amber-100 text-amber-700">⏳ قيد الانتظار</span>',
    failed: '<span class="badge bg-rose-100 text-rose-700">❌ فشل</span>',
    refunded: '<span class="badge bg-slate-200 text-slate-700">💸 مُسترجع</span>',
    cancelled: '<span class="badge bg-slate-200 text-slate-700">🚫 ملغى</span>',
  };

  document.getElementById('box').innerHTML = result.data.length ? `
    <div class="space-y-3">
      ${result.data.map(order => `
        <a href="#/orders/${esc(order.number)}" class="card p-4 flex items-center gap-4 card-hover">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono font-bold text-sm">${esc(order.number)}</span>
              ${statusBadge[order.status] || ''}
            </div>
            <p class="text-xs text-slate-500 mt-1">${formatDate(order.created_at, true)} • ${order.items.length} عنصر</p>
            <p class="text-xs text-slate-600 mt-1 truncate">${order.items.map(i => esc(i.title)).join('، ')}</p>
          </div>
          <span class="font-extrabold shrink-0">${money(order.total)}</span>
        </a>`).join('')}
    </div>`
    : emptyState('🧾', 'لا توجد طلبات بعد', 'ستظهر هنا كل مشترياتك.',
        '<a href="#/courses" class="btn btn-primary">ابدأ التسوّق</a>');
}

export async function orderDetail({ view, params }) {
  view.innerHTML = spinner();
  let data;
  try { data = await api.get(`/orders/${params.number}`); }
  catch (err) { view.innerHTML = errorState(err.message, '#/orders'); return; }

  const { order, items, payments, invoice } = data;
  view.innerHTML = section(`
    <div class="max-w-3xl mx-auto">
      <div class="card p-6">
        <div class="flex justify-between items-start mb-6 pb-6 border-b">
          <div>
            <h1 class="text-xl font-extrabold font-display">فاتورة</h1>
            <p class="text-sm text-slate-500 mt-1">${esc(invoice.platform)}</p>
          </div>
          <div class="text-left text-sm">
            <p class="font-mono font-bold">${esc(order.number)}</p>
            <p class="text-slate-500">${formatDate(order.created_at, true)}</p>
          </div>
        </div>

        <table class="w-full text-sm mb-6">
          <thead class="text-right text-slate-500 border-b">
            <tr><th class="pb-2">العنصر</th><th class="pb-2 text-left">السعر</th></tr>
          </thead>
          <tbody>
            ${items.map(i => `<tr class="border-b last:border-0">
              <td class="py-3"><span class="badge bg-slate-100 text-slate-600 ml-2">${typeLabels[i.item_type] || ''}</span>${esc(i.title)}</td>
              <td class="py-3 text-left font-bold">${money(i.unit_price)}</td></tr>`).join('')}
          </tbody>
        </table>

        <div class="space-y-2 text-sm max-w-xs mr-auto">
          <div class="flex justify-between"><span class="text-slate-500">المجموع</span><span>${money(order.subtotal)}</span></div>
          ${order.discount > 0 ? `<div class="flex justify-between text-brand-700"><span>الخصم</span><span>- ${money(order.discount)}</span></div>` : ''}
          ${order.tax > 0 ? `<div class="flex justify-between"><span class="text-slate-500">الضريبة</span><span>${money(order.tax)}</span></div>` : ''}
          <div class="flex justify-between text-lg pt-2 border-t"><span class="font-bold">الإجمالي</span><span class="font-extrabold">${money(order.total)}</span></div>
        </div>

        <div class="mt-6 pt-6 border-t flex items-center justify-between flex-wrap gap-3">
          <div class="text-sm">
            <p class="text-slate-500">الحالة: <span class="font-bold text-slate-900">${
              { paid: 'مدفوع ✅', pending: 'قيد الانتظار ⏳', failed: 'فشل ❌', refunded: 'مُسترجع 💸', cancelled: 'ملغى' }[order.status]}</span></p>
            ${order.provider ? `<p class="text-slate-500">وسيلة الدفع: ${esc(order.provider)}</p>` : ''}
          </div>
          <div class="flex gap-2 no-print">
            <button onclick="window.print()" class="btn btn-ghost btn-sm">🖨 طباعة</button>
            ${order.status === 'pending' && order.provider === 'mock'
              ? `<a href="#/checkout/pay/${esc(order.number)}" class="btn btn-primary btn-sm">أكمل الدفع</a>` : ''}
            <a href="#/orders" class="btn btn-ghost btn-sm">← الطلبات</a>
          </div>
        </div>
      </div>
    </div>`);
}

/* ============================ المحفظة ============================ */
export async function wallet({ view }) {
  view.innerHTML = pageHeader('محفظتي') + section(`<div id="box">${spinner()}</div>`);
  const box = document.getElementById('box');

  const render = async () => {
    const data = await api.get('/wallet');
    const typeLabel = {
      topup: '💳 شحن رصيد', purchase: '🛒 عملية شراء', refund: '💸 استرجاع', payout: '🏦 سحب أرباح',
      earning: '💰 أرباح', referral: '🎁 مكافأة إحالة', bonus: '🎉 مكافأة', adjustment: '⚙️ تسوية إدارية',
    };

    box.innerHTML = `
      <div class="grid lg:grid-cols-3 gap-6">
        <div>
          <div class="card p-6 text-center bg-gradient-to-bl from-brand-600 to-brand-800 text-white">
            <p class="text-brand-100 text-sm">رصيدك الحالي</p>
            <p class="text-4xl font-extrabold my-3">${money(data.balance)}</p>
            <button id="topupBtn" class="btn bg-white text-brand-700 hover:bg-brand-50 w-full">💳 شحن الرصيد</button>
          </div>
          <div class="card p-4 mt-4 text-sm text-slate-600">
            <p class="font-bold text-slate-900 mb-2">لماذا المحفظة؟</p>
            <ul class="space-y-1.5">
              <li>⚡ شراء فوري بنقرة واحدة</li>
              <li>🎁 تُودع فيها مكافآت الإحالة</li>
              <li>💸 تُعاد إليها مبالغ الاسترجاع</li>
            </ul>
          </div>
        </div>

        <div class="lg:col-span-2">
          <div class="card p-5">
            <h2 class="font-bold font-display mb-4">سجلّ الحركات</h2>
            ${data.transactions.length ? `<div class="space-y-2">
              ${data.transactions.map(tx => `
                <div class="flex items-center justify-between py-2.5 border-b last:border-0">
                  <div class="min-w-0">
                    <p class="text-sm font-semibold">${typeLabel[tx.type] || tx.type}</p>
                    <p class="text-xs text-slate-500 truncate">${esc(tx.note || '')} • ${formatDate(tx.created_at, true)}</p>
                  </div>
                  <div class="text-left shrink-0">
                    <p class="font-bold ${tx.amount >= 0 ? 'text-brand-600' : 'text-rose-600'}">
                      ${tx.amount >= 0 ? '+' : ''}${money(tx.amount)}</p>
                    <p class="text-xs text-slate-400">الرصيد: ${money(tx.balance_after)}</p>
                  </div>
                </div>`).join('')}</div>`
              : '<p class="text-slate-500 text-sm">لا حركات بعد.</p>'}
          </div>
        </div>
      </div>`;

    document.getElementById('topupBtn').addEventListener('click', () => {
      const dialog = modal({
        title: 'شحن الرصيد',
        body: `<form id="topupForm" class="space-y-4">
          <div><label class="label">المبلغ</label>
            <input name="amount" type="number" min="1" step="0.5" value="10" required class="field" /></div>
          <div class="grid grid-cols-4 gap-2">
            ${[5, 10, 25, 50].map(v => `<button type="button" data-amount="${v}" class="btn btn-ghost btn-sm">${v}</button>`).join('')}
          </div>
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            وضع تجريبي: يُضاف الرصيد فوراً دون خصم حقيقي.</div>
          <button class="btn btn-primary w-full">شحن الآن</button></form>`,
      });
      dialog.el.querySelectorAll('[data-amount]').forEach(btn => btn.addEventListener('click', () => {
        dialog.el.querySelector('[name="amount"]').value = btn.dataset.amount;
      }));
      dialog.el.querySelector('#topupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api.post('/wallet/topup', { amount: Number(e.target.amount.value), provider: 'mock' });
          await refreshUser();
          dialog.close(); toast('تم شحن الرصيد 💰', 'success'); render();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  };

  try { await render(); } catch (err) { box.innerHTML = errorState(err.message); }
}

/* ============================ الباقات ============================ */
export async function plans({ view }) {
  view.innerHTML = pageHeader('باقات الاشتراك', 'وصول غير محدود بدل الشراء عنصراً عنصراً') +
    section(`<div id="box">${spinner()}</div>`);

  const data = await api.get('/plans');
  const current = data.current;

  document.getElementById('box').innerHTML = `
    ${current ? `<div class="card p-4 mb-6 bg-brand-50 border-brand-200 flex items-center justify-between flex-wrap gap-3">
      <div><p class="font-bold text-brand-800">✨ اشتراكك الحالي: ${esc(current.plan_name)}</p>
        <p class="text-sm text-slate-600">سارٍ حتى ${formatDate(current.ends_at)}</p></div>
      <button id="cancelSub" class="btn btn-ghost btn-sm">إلغاء التجديد</button>
    </div>` : ''}

    <div class="grid gap-6 md:grid-cols-3">
      ${data.plans.map((plan, i) => `
        <div class="card p-6 relative ${i === 1 ? 'ring-2 ring-brand-500 md:scale-105' : ''}">
          ${i === 1 ? '<span class="badge bg-brand-600 text-white absolute -top-3 right-6">الأكثر اختياراً</span>' : ''}
          <h3 class="text-xl font-extrabold font-display">${esc(plan.name)}</h3>
          <p class="text-sm text-slate-500 mt-1 min-h-10">${esc(plan.description || '')}</p>
          <p class="text-4xl font-extrabold my-4">${money(plan.price)}
            <span class="text-sm font-normal text-slate-500">/${plan.interval === 'year' ? 'سنة' : 'شهر'}</span></p>
          <ul class="space-y-2 text-sm mb-6">
            ${(plan.features || []).map(f => `<li class="flex gap-2"><span class="text-brand-600">✓</span>${esc(f)}</li>`).join('')}
          </ul>
          <button data-plan="${plan.id}" class="btn ${i === 1 ? 'btn-primary' : 'btn-ghost'} w-full"
            ${current?.plan_id === plan.id ? 'disabled' : ''}>
            ${current?.plan_id === plan.id ? 'باقتك الحالية' : current ? 'ترقية' : 'اشترك الآن'}
          </button>
        </div>`).join('')}
    </div>

    <div class="card p-6 mt-8">
      <h3 class="font-bold font-display mb-3">أسئلة شائعة</h3>
      <div class="space-y-3 text-sm">
        ${[['هل يمكنني الإلغاء في أي وقت؟', 'نعم — الإلغاء يوقف التجديد فقط، وتبقى المدة المدفوعة سارية حتى نهايتها.'],
           ['ماذا يشمل الاشتراك؟', 'حسب الباقة: الملخّصات وحدها، أو الملخّصات مع كل الدورات المسجّلة وخصم على الحصص المباشرة.'],
           ['هل الحصص المباشرة مشمولة؟', 'الحصص المباشرة تُحجز بشكل منفصل، لكن المشتركين يحصلون على خصم عليها.']]
          .map(([q, a]) => `<details class="border rounded-xl p-3">
            <summary class="font-semibold cursor-pointer">${q}</summary>
            <p class="text-slate-600 mt-2">${a}</p></details>`).join('')}
      </div>
    </div>`;

  view.querySelectorAll('[data-plan]').forEach(btn => btn.addEventListener('click', async () => {
    if (!state.user) return navigate('/login?next=/plans');
    btn.disabled = true;
    try {
      const result = await api.post('/checkout', {
        items: [{ item_type: 'plan', item_id: Number(btn.dataset.plan) }], provider: 'mock',
      });
      if (result.checkoutUrl?.startsWith('/#')) location.hash = result.checkoutUrl.slice(1);
      else if (result.paid) { await refreshUser(); toast('تم تفعيل اشتراكك 🎉', 'success'); navigate('/plans'); }
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  }));

  document.getElementById('cancelSub')?.addEventListener('click', async () => {
    if (!await confirmDialog('سيتوقّف التجديد التلقائي — وتبقى المدة المدفوعة سارية. متابعة؟')) return;
    const result = await api.post('/subscriptions/cancel');
    toast(result.message, 'info', 6000);
  });
}
