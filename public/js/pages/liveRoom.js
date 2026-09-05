import { api } from '../api.js';
import { state, connectSocket } from '../store.js';
import { esc, spinner, toast, avatar, errorState, emptyState, formatDate, modal } from '../ui.js';
import { navigate } from '../router.js';

/**
 * قاعة البثّ المباشر: دردشة، رفع يد، حضور، ومسابقة تفاعلية.
 * الاتصال عبر Socket.IO والتحقّق من الصلاحية يتم في الخادم.
 */
export async function liveRoom({ view, params }) {
  view.innerHTML = spinner('نصلك بالقاعة...');

  let data;
  try { data = await api.get(`/live/${params.id}/room`); }
  catch (err) {
    view.innerHTML = errorState(err.message, `#/live/${params.id}`);
    return;
  }

  const { session, isHost, meetingUrl, provider, messages, participants } = data;
  const socket = connectSocket();
  if (!socket) {
    view.innerHTML = errorState('تعذّر الاتصال بخدمة البثّ. حدّث الصفحة.');
    return;
  }

  let quizState = null;
  let quizTimer = null;

  view.innerHTML = `
    <div class="bg-slate-900 min-h-[calc(100vh-4rem)] text-white">
      <div class="max-w-[1600px] mx-auto grid lg:grid-cols-[1fr_360px] gap-0 min-h-[calc(100vh-4rem)]">

        <!-- منطقة العرض -->
        <div class="flex flex-col">
          <div class="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
            <a href="#/live/${session.id}" class="text-slate-400 hover:text-white text-sm">←</a>
            <div class="flex-1 min-w-0">
              <h1 class="font-bold truncate">${esc(session.title)}</h1>
              <p class="text-xs text-slate-400">${formatDate(session.starts_at, true)} • ${session.duration_minutes} دقيقة</p>
            </div>
            <span id="statusBadge" class="badge ${session.status === 'live' ? 'bg-rose-600' : 'bg-slate-700'}">
              ${session.status === 'live' ? '🔴 مباشر' : '⏸ لم تبدأ'}
            </span>
          </div>

          <div class="flex-1 p-4">
            <div id="stage" class="bg-black rounded-2xl aspect-video grid place-items-center text-center p-6 border border-slate-800">
              ${meetingUrl && provider !== 'internal' ? `
                <div>
                  <div class="text-5xl mb-4">🎥</div>
                  <p class="text-slate-300 mb-4">تُبثّ هذه الحصة عبر ${esc(provider)}</p>
                  <a href="${esc(meetingUrl)}" target="_blank" rel="noopener" class="btn btn-primary">افتح رابط البثّ</a>
                </div>` : `
                <div>
                  <div class="text-5xl mb-4">${session.status === 'live' ? '🔴' : '⏳'}</div>
                  <p class="text-slate-300 text-lg font-bold mb-1">${session.status === 'live' ? 'الحصة جارية' : 'بانتظار بدء المعلّم'}</p>
                  <p class="text-slate-500 text-sm">استخدم الدردشة والمسابقة للتفاعل مع المعلّم.</p>
                  <p class="text-slate-600 text-xs mt-4">رمز القاعة: <span class="font-mono">${esc(session.room_code || '—')}</span></p>
                </div>`}
            </div>

            <!-- شريط أدوات -->
            <div class="flex flex-wrap gap-2 mt-4">
              ${isHost ? `
                ${session.status !== 'live' ? '<button id="startBtn" class="btn btn-danger btn-sm">🔴 ابدأ البثّ</button>' : ''}
                <button id="quizBtn" class="btn btn-amber btn-sm">🏆 ابدأ مسابقة</button>
                <button id="attendanceBtn" class="btn btn-ghost btn-sm">📋 كشف الحضور</button>
                <button id="endBtn" class="btn btn-ghost btn-sm">⏹ إنهاء الحصة</button>
              ` : `
                <button id="handBtn" class="btn btn-ghost btn-sm">✋ ارفع يدك</button>
              `}
            </div>

            <!-- لوحة المسابقة -->
            <div id="quizPanel" class="hidden mt-4"></div>
          </div>
        </div>

        <!-- اللوحة الجانبية -->
        <aside class="border-r border-slate-800 flex flex-col bg-slate-950/50 max-h-[calc(100vh-4rem)]">
          <div class="flex border-b border-slate-800">
            <button data-tab="chat" class="flex-1 py-3 text-sm font-bold border-b-2 border-brand-500 text-white">💬 الدردشة</button>
            <button data-tab="people" class="flex-1 py-3 text-sm font-bold border-b-2 border-transparent text-slate-400">
              👥 المشاركون <span id="peopleCount">(${participants.length})</span></button>
          </div>

          <div id="chatTab" class="flex-1 flex flex-col overflow-hidden">
            <div id="messages" class="flex-1 overflow-auto p-3 space-y-3"></div>
            <form id="chatForm" class="p-3 border-t border-slate-800 flex gap-2">
              <input name="body" maxlength="1000" placeholder="اكتب رسالتك..." autocomplete="off"
                     class="flex-1 rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-brand-500" />
              <button class="btn btn-primary btn-sm">إرسال</button>
            </form>
          </div>

          <div id="peopleTab" class="hidden flex-1 overflow-auto p-3 space-y-2"></div>
        </aside>
      </div>
    </div>`;

  /* ---------------------- الدردشة ---------------------- */
  const messagesEl = document.getElementById('messages');

  const renderMessage = (m) => {
    const mine = m.user_id === state.user?.id;
    const el = document.createElement('div');
    el.className = `flex gap-2 ${mine ? 'flex-row-reverse' : ''} animate-fade-in`;
    el.innerHTML = `
      <div class="shrink-0">${avatar(m.user_avatar, m.user_name, 8)}</div>
      <div class="max-w-[80%]">
        <div class="flex items-center gap-1.5 ${mine ? 'flex-row-reverse' : ''}">
          <span class="text-xs font-bold text-slate-300">${esc(m.user_name)}</span>
          ${m.isHost || m.user_id === session.instructor_id ? '<span class="badge bg-brand-600 text-white text-[10px]">المعلّم</span>' : ''}
        </div>
        <div class="rounded-2xl px-3 py-2 mt-0.5 text-sm ${mine ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-100'}">
          ${esc(m.body)}
        </div>
      </div>`;
    messagesEl.append(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const systemMessage = (text) => {
    const el = document.createElement('p');
    el.className = 'text-center text-xs text-slate-500 py-1';
    el.textContent = text;
    messagesEl.append(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  messages.forEach(renderMessage);

  document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.body;
    const body = input.value.trim();
    if (!body) return;
    socket.emit('live:message', { body }, (res) => {
      if (res?.error) toast(res.error, 'error');
    });
    input.value = '';
  });

  /* ---------------------- التبويبات ---------------------- */
  view.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => {
    const isChat = btn.dataset.tab === 'chat';
    document.getElementById('chatTab').classList.toggle('hidden', !isChat);
    document.getElementById('peopleTab').classList.toggle('hidden', isChat);
    view.querySelectorAll('[data-tab]').forEach(b => {
      const active = b === btn;
      b.className = `flex-1 py-3 text-sm font-bold border-b-2 ${active ? 'border-brand-500 text-white' : 'border-transparent text-slate-400'}`;
    });
  }));

  const renderPeople = (list) => {
    document.getElementById('peopleCount').textContent = `(${list.length})`;
    document.getElementById('peopleTab').innerHTML = list.map(p => `
      <div class="flex items-center gap-2 p-2 rounded-xl ${p.handRaised ? 'bg-amber-500/20 border border-amber-500/40' : 'bg-slate-800/50'}">
        ${avatar(p.avatar, p.name, 8)}
        <span class="text-sm flex-1 truncate">${esc(p.name)}</span>
        ${p.isHost ? '<span class="badge bg-brand-600 text-white text-[10px]">المعلّم</span>' : ''}
        ${p.handRaised ? '<span title="رفع يده">✋</span>' : ''}
      </div>`).join('') || '<p class="text-slate-500 text-sm text-center py-4">لا أحد في القاعة بعد</p>';
  };
  renderPeople(participants.map(p => ({ ...p, isHost: p.id === session.instructor_id })));

  /* ---------------------- أحداث القاعة ---------------------- */
  socket.emit('live:join', { sessionId: session.id }, (res) => {
    if (res?.error) { toast(res.error, 'error'); navigate(`/live/${session.id}`); return; }
    renderPeople(res.participants);
    systemMessage('انضممت إلى القاعة');
  });

  socket.on('live:message', renderMessage);
  socket.on('live:system', (payload) => systemMessage(payload.message));
  socket.on('live:presence', (payload) => renderPeople(payload.participants));
  socket.on('session:started', () => {
    const badge = document.getElementById('statusBadge');
    badge.className = 'badge bg-rose-600';
    badge.innerHTML = '🔴 مباشر';
    document.getElementById('startBtn')?.remove();
    const stage = document.getElementById('stage');
    const heading = stage?.querySelector('p.text-lg');
    if (heading) { heading.textContent = 'الحصة جارية'; stage.querySelector('.text-5xl').textContent = '🔴'; }
    toast('بدأت الحصة 🔴', 'success');
  });
  socket.on('session:ended', () => {
    toast('انتهت الحصة', 'info');
    setTimeout(() => navigate(`/live/${session.id}`), 2000);
  });

  /* ---------------------- رفع اليد ---------------------- */
  let handRaised = false;
  document.getElementById('handBtn')?.addEventListener('click', (e) => {
    handRaised = !handRaised;
    socket.emit('live:hand', { raised: handRaised });
    e.target.className = `btn btn-sm ${handRaised ? 'btn-amber' : 'btn-ghost'}`;
    e.target.textContent = handRaised ? '✋ يدك مرفوعة' : '✋ ارفع يدك';
  });

  /* ---------------------- أدوات المضيف ---------------------- */
  document.getElementById('startBtn')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api.post(`/live/${session.id}/start`); toast('بدأ البثّ 🔴', 'success'); }
    catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  });

  document.getElementById('endBtn')?.addEventListener('click', async () => {
    const dialog = modal({
      title: 'إنهاء الحصة',
      body: `<form id="endForm" class="space-y-3">
        <p class="text-sm text-slate-600">سيُسجَّل الحضور ويُغلق البثّ للجميع.</p>
        <div><label class="label">رابط التسجيل (اختياري)</label>
          <input name="recording_url" class="field" placeholder="https://..." /></div>
        <button class="btn btn-danger w-full">تأكيد الإنهاء</button></form>`,
    });
    dialog.el.querySelector('#endForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post(`/live/${session.id}/end`, { recording_url: e.target.recording_url.value || null });
        dialog.close(); toast('انتهت الحصة', 'success');
        navigate('/instructor/live');
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  document.getElementById('attendanceBtn')?.addEventListener('click', async () => {
    const result = await api.get(`/live/${session.id}/attendance`);
    modal({
      title: 'كشف الحضور', size: 'max-w-2xl',
      body: `<table class="w-full text-sm">
        <thead class="text-right text-slate-500 border-b"><tr>
          <th class="pb-2">الطالب</th><th>الحالة</th><th>الدخول</th><th>الدقائق</th></tr></thead>
        <tbody>${result.attendance.map(a => `
          <tr class="border-b last:border-0">
            <td class="py-2 font-semibold">${esc(a.name)}</td>
            <td>${{ booked: '⏳ محجوز', attended: '✅ حضر', absent: '❌ غائب', cancelled: '🚫 ملغى', refunded: '💸 مُسترجع' }[a.status] || a.status}</td>
            <td class="text-xs text-slate-500">${a.joined_at ? formatDate(a.joined_at, true) : '—'}</td>
            <td class="tabular-nums">${a.attendance_minutes || 0}</td>
          </tr>`).join('') || '<tr><td colspan="4" class="py-4 text-center text-slate-400">لا حجوزات</td></tr>'}
        </tbody></table>`,
    });
  });

  /* ---------------------- المسابقة التفاعلية ---------------------- */
  const quizPanel = document.getElementById('quizPanel');

  document.getElementById('quizBtn')?.addEventListener('click', async () => {
    // نجلب اختبارات الحصة الجاهزة من المعلّم
    let quizzes = [];
    try {
      const courses = await api.get('/instructor/live');
      quizzes = courses.data.filter(s => s.id === session.id);
    } catch {}

    const dialog = modal({
      title: 'ابدأ مسابقة تفاعلية',
      body: `<p class="text-sm text-slate-600 mb-3">أدخل رقم الاختبار المرتبط بهذه الحصة (أنشئه من لوحة المعلّم).</p>
        <form id="quizStartForm" class="flex gap-2">
          <input name="quizId" type="number" required placeholder="رقم الاختبار" class="field flex-1" />
          <button class="btn btn-primary">ابدأ</button></form>
        <p class="help mt-2">تُحتسب النقاط حسب صحة الإجابة وسرعتها.</p>`,
    });

    dialog.el.querySelector('#quizStartForm').addEventListener('submit', (e) => {
      e.preventDefault();
      socket.emit('quiz:start', { quizId: Number(e.target.quizId.value) }, (res) => {
        if (res?.error) return toast(res.error, 'error');
        dialog.close();
        toast(`جاهز — ${res.total} أسئلة`, 'success');
      });
    });
  });

  socket.on('quiz:ready', ({ title, total }) => {
    quizPanel.classList.remove('hidden');
    quizPanel.innerHTML = `
      <div class="bg-gradient-to-l from-amber-500 to-orange-600 rounded-2xl p-5 text-center">
        <div class="text-4xl mb-2">🏆</div>
        <h3 class="font-extrabold text-xl font-display">${esc(title)}</h3>
        <p class="text-white/90 text-sm mt-1">${total} أسئلة — استعدّ!</p>
        ${isHost ? '<button id="nextQ" class="btn bg-white text-orange-700 hover:bg-orange-50 mt-3">▶️ السؤال الأول</button>' : ''}
      </div>`;
    document.getElementById('nextQ')?.addEventListener('click', () => socket.emit('quiz:next', {}, () => {}));
  });

  socket.on('quiz:question', (payload) => {
    clearInterval(quizTimer);
    let remaining = payload.seconds;
    quizState = { answered: false };

    quizPanel.classList.remove('hidden');
    quizPanel.innerHTML = `
      <div class="bg-slate-800 rounded-2xl p-5 border border-slate-700">
        <div class="flex items-center justify-between mb-3">
          <span class="badge bg-slate-700">سؤال ${payload.index + 1} من ${payload.total}</span>
          <span id="qTimer" class="text-2xl font-extrabold tabular-nums text-amber-400">${remaining}</span>
        </div>
        <h3 class="text-lg font-bold mb-4">${esc(payload.text)}</h3>
        <div class="grid sm:grid-cols-2 gap-2 no-select" id="quizOptions">
          ${payload.options.map((option, i) => `
            <button data-choice="${i}" class="text-right p-3 rounded-xl bg-slate-700 hover:bg-brand-600 transition-colors text-sm font-semibold">
              <span class="inline-block w-6 h-6 rounded-lg bg-slate-900/40 text-center leading-6 ml-2">${['أ', 'ب', 'ج', 'د', 'هـ', 'و'][i] || i + 1}</span>
              ${esc(option)}
            </button>`).join('')}
        </div>
        <p id="answeredCount" class="text-xs text-slate-400 mt-3 text-center"></p>
        ${isHost ? '<div class="flex gap-2 mt-3"><button id="revealBtn" class="btn btn-amber btn-sm flex-1">👁 اكشف الإجابة</button><button id="nextQ" class="btn btn-ghost btn-sm flex-1">التالي ←</button></div>' : ''}
      </div>`;

    quizTimer = setInterval(() => {
      remaining -= 1;
      const el = document.getElementById('qTimer');
      if (el) el.textContent = Math.max(0, remaining);
      if (remaining <= 0) clearInterval(quizTimer);
    }, 1000);

    quizPanel.querySelectorAll('[data-choice]').forEach(btn => btn.addEventListener('click', () => {
      if (quizState.answered) return;
      quizState.answered = true;
      quizPanel.querySelectorAll('[data-choice]').forEach(b => {
        b.disabled = true;
        b.classList.add('opacity-50');
      });
      btn.classList.remove('opacity-50');
      btn.classList.add('ring-2', 'ring-white', 'bg-brand-600');
      socket.emit('quiz:answer', { choices: [Number(btn.dataset.choice)] }, (res) => {
        if (res?.error) toast(res.error, 'warn');
      });
    }));

    document.getElementById('revealBtn')?.addEventListener('click', () => socket.emit('quiz:reveal', {}, () => {}));
    document.getElementById('nextQ')?.addEventListener('click', () => socket.emit('quiz:next', {}, () => {}));
  });

  socket.on('quiz:answered', ({ answered, total }) => {
    const el = document.getElementById('answeredCount');
    if (el) el.textContent = `أجاب ${answered} من ${total}`;
  });

  socket.on('quiz:my-result', ({ isCorrect, points, total }) => {
    toast(isCorrect ? `✅ إجابة صحيحة +${points} نقطة (المجموع ${total})` : '❌ إجابة خاطئة', isCorrect ? 'success' : 'warn');
  });

  socket.on('quiz:reveal', ({ correct, explanation, distribution, leaderboard }) => {
    clearInterval(quizTimer);
    quizPanel.querySelectorAll('[data-choice]').forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.remove('bg-slate-700', 'opacity-50');
      btn.classList.add(correct.includes(i) ? 'bg-brand-600' : 'bg-slate-700/50');
      const count = distribution[i] ?? 0;
      btn.insertAdjacentHTML('beforeend', `<span class="float-left text-xs opacity-80">${count}</span>`);
    });
    if (explanation) {
      quizPanel.insertAdjacentHTML('beforeend',
        `<p class="text-sm bg-slate-800 rounded-xl p-3 mt-2 text-slate-300">💡 ${esc(explanation)}</p>`);
    }
    if (leaderboard?.length) {
      quizPanel.insertAdjacentHTML('beforeend', `
        <div class="mt-3 bg-slate-800 rounded-xl p-3">
          <p class="text-xs font-bold text-slate-400 mb-2">🏅 المتصدّرون</p>
          ${leaderboard.map((entry, i) => `
            <div class="flex justify-between text-sm py-1">
              <span>${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${esc(entry.name)}</span>
              <span class="font-bold tabular-nums text-amber-400">${entry.score}</span>
            </div>`).join('')}
        </div>`);
    }
  });

  socket.on('quiz:finished', ({ leaderboard }) => {
    clearInterval(quizTimer);
    quizPanel.innerHTML = `
      <div class="bg-gradient-to-l from-amber-500 to-orange-600 rounded-2xl p-6 text-center">
        <div class="text-5xl mb-2">🎉</div>
        <h3 class="text-xl font-extrabold font-display mb-4">انتهت المسابقة</h3>
        <div class="bg-black/20 rounded-xl p-4 text-right max-w-sm mx-auto">
          ${leaderboard.map((entry, i) => `
            <div class="flex justify-between py-1.5 ${i < 3 ? 'font-bold text-lg' : 'text-sm'}">
              <span>${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${esc(entry.name)}</span>
              <span class="tabular-nums">${entry.score}</span>
            </div>`).join('') || '<p class="text-sm">لا مشاركات</p>'}
        </div>
      </div>`;
  });

  // تنظيف عند مغادرة الصفحة
  return () => {
    clearInterval(quizTimer);
    ['live:message', 'live:system', 'live:presence', 'session:started', 'session:ended',
     'quiz:ready', 'quiz:question', 'quiz:answered', 'quiz:reveal', 'quiz:finished', 'quiz:my-result']
      .forEach(event => socket.off(event));
  };
}
