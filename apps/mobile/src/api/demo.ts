/**
 * وضع العرض (EXPO_PUBLIC_DEMO=1): التطبيق كاملاً بلا خادم — تُنفَّذ الطلبات محلياً على لقطة حقيقية من بيانات التطوير،
 * مع سلوك حيّ للشراء والحجز والاختبارات والمحادثة. يُستخدم لرابط العرض فقط؛ الإنتاج يخاطب الخادم.
 */
import raw from './demo-data.json';

const D: any = raw;
const KEY = 'mn_demo_state_v1';
const H = 3_600_000;
const iso = (d: Date | number) => new Date(d).toISOString();
const muscatDate = (t: number) => new Date(t + 4 * H).toISOString().slice(0, 10);
const muscat = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+04:00`).getTime();
const norm = (s: string) => String(s || '').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\bال/g, '').toLowerCase();
const num = () => `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const money = (n: number) => Math.round(n * 1000) / 1000;
const POLICY = [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 12, refundPercent: 50 }, { hoursBefore: 0, refundPercent: 0 }];
const TEACHER_NAME = 'أ. خالد الهنائي';

interface State {
  who: 'student' | 'teacher' | 'new' | null; newUser: any;
  owned: { book: number[]; course: number[] }; cart: { id: number; itemType: string; itemId: number }[]; coupon: string | null;
  wallet: number; walletTx: any[]; bookings: any[]; orders: any[]; packages: any[];
  fav: { book: number[]; course: number[]; teacher: number[] }; reading: Record<string, { lastPage: number; bookmarks: number[] }>;
  progress: Record<string, { pos: number; completed: boolean }>; attempts: Record<string, number>; reviewed: string[];
  notifications: any[]; conversations: any[]; messages: Record<string, any[]>; notes: Record<string, any>;
  teacherRules: any[]; timeOff: any[]; payouts: any[]; teacherApplied: boolean; seq: number;
}
let S: State;

/* ---------- تهيئة الحالة من اللقطة، مع تحريك التواريخ إلى الآن ---------- */
function shiftedBookings(): any[] {
  const now = Date.now();
  const list = D.student.bookings.map((b: any) => ({ ...b }));
  const upcoming = list.filter((b: any) => ['confirmed', 'in_progress', 'pending_payment'].includes(b.status));
  const past = list.filter((b: any) => !upcoming.includes(b));
  // الحصة القادمة: تبدأ بعد ٥ دقائق حتى تُفتح القاعة في العرض، والثانية غداً ١٧:٠٠
  upcoming.forEach((b: any, i: number) => {
    const start = i === 0 ? now + 5 * 60_000 : muscat(muscatDate(now + 86_400_000), '17:00');
    b.startsAt = iso(start); b.endsAt = iso(start + b.durationMinutes * 60_000);
  });
  past.forEach((b: any, i: number) => { const start = now - (i + 2) * 86_400_000; b.startsAt = iso(start); b.endsAt = iso(start + b.durationMinutes * 60_000); });
  return [...upcoming, ...past];
}
function fresh(): State {
  const p = D.student.purchases;
  return {
    who: null, newUser: null,
    owned: { book: p.books.map((b: any) => b.id), course: p.courses.map((c: any) => c.id) }, cart: [], coupon: null,
    wallet: D.student.wallet.balance, walletTx: D.student.wallet.transactions, bookings: shiftedBookings(), orders: p.orders, packages: D.student.lessons.packages ?? [],
    fav: { book: D.student.favorites.books.map((b: any) => b.id), course: D.student.favorites.courses.map((c: any) => c.id), teacher: D.student.favorites.teachers.map((t: any) => t.id) },
    reading: { 1: { lastPage: 22, bookmarks: [5, 17] } }, progress: {}, attempts: {}, reviewed: ['teacher:5', 'book:1', 'course:1'],
    notifications: D.student.notifications.data, conversations: [], messages: {}, notes: {},
    teacherRules: D.teacher.availability.rules, timeOff: D.teacher.availability.timeOff, payouts: D.teacher.earnings.payouts, teacherApplied: false, seq: 5000,
  };
}
function load() {
  if (S) return;
  try { const s = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null; S = s ? { ...fresh(), ...JSON.parse(s), bookings: undefined } as State : fresh(); if (!S.bookings) S.bookings = fresh().bookings; } catch { S = fresh(); }
  // لو حُفظت حجوزات قديمة نُبقيها لكن نضمن حصة قريبة للعرض
  if (!S.bookings.some(b => b.status === 'confirmed' && new Date(b.endsAt).getTime() > Date.now())) S.bookings = shiftedBookings();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify({ ...S, bookings: S.bookings })); } catch { /* تجاهل */ } }
const nextId = () => ++S.seq;

/* ---------- المستخدم ---------- */
function user() {
  if (S.who === 'teacher') return D.teacher.user;
  if (S.who === 'new') return S.newUser;
  return D.student.user;
}
const uid = () => user()?.id ?? 0;
const isTeacher = () => S.who === 'teacher';

/* ---------- تحويلات ---------- */
const bookCard = (b: any) => ({ ...b, owned: S.owned.book.includes(b.id) || b.price === 0, favorited: S.fav.book.includes(b.id) });
const courseCard = (c: any) => ({ ...c, enrolled: S.owned.course.includes(c.id), favorited: S.fav.course.includes(c.id), progressPercent: S.owned.course.includes(c.id) ? courseProgress(c.id) : null });
const teacherCard = (t: any) => ({ ...t, favorited: S.fav.teacher.includes(t.id), nextSlotAt: nextSlot(t.id), availableNow: false });
function courseProgress(courseId: number) {
  const det = D.courseDetails[courseId]; if (!det) return 0;
  const ids = det.sections.flatMap((s: any) => s.lessons.map((l: any) => l.id));
  const captured = det.sections.flatMap((s: any) => s.lessons).filter((l: any) => l.completed).length;
  const done = ids.filter((id: number) => S.progress[id]?.completed || det.sections.flatMap((s: any) => s.lessons).find((l: any) => l.id === id)?.completed).length;
  return Math.round((Math.max(done, captured) / ids.length) * 100);
}
function refundPercent(startsAt: string) { const h = (new Date(startsAt).getTime() - Date.now()) / H; for (const r of [...POLICY].sort((a, b) => b.hoursBefore - a.hoursBefore)) if (h >= r.hoursBefore) return r.refundPercent; return 0; }
function bookingView(b: any) {
  const now = Date.now(), st = new Date(b.startsAt).getTime(), en = new Date(b.endsAt).getTime();
  const open = st - 15 * 60_000, close = en + 30 * 60_000;
  const canJoin = ['confirmed', 'in_progress'].includes(b.status) && now >= open && now <= close;
  const canCancel = ['pending_payment', 'confirmed'].includes(b.status) && st > now;
  return { ...b, roomOpensAt: iso(open), canJoin, canCancel, canReschedule: canCancel && b.status === 'confirmed', cancelRefundPercent: canCancel ? (b.status === 'pending_payment' ? 100 : refundPercent(b.startsAt)) : 0,
    needsReview: b.status === 'completed' && !isTeacher() && !S.reviewed.includes(`teacher:${b.teacher.id}`) && b.id !== D.student.bookings[0]?.id && !S.reviewed.includes(`booking:${b.id}`), notes: S.notes[b.id] ?? b.notes ?? null };
}
const orderView = (o: any) => o;

/* ---------- المواعيد ---------- */
const RULES = [{ days: [0, 1, 2, 3, 4], from: '16:00', to: '21:00' }, { days: [6], from: '10:00', to: '14:00' }];
function slots(teacherId: number, from: string, days: number, duration: number) {
  const out: any[] = []; const now = Date.now();
  const start = muscat(from.length > 10 ? muscatDate(new Date(from).getTime()) : from.slice(0, 10), '00:00');
  for (let d = 0; d < days; d++) {
    const dayStart = start + d * 86_400_000; const date = muscatDate(dayStart); const wd = new Date(dayStart + 4 * H).getUTCDay();
    const list: any[] = [];
    for (const r of (isTeacher() ? S.teacherRules.map((x: any) => ({ days: [x.weekday], from: x.startTime, to: x.endTime })) : RULES)) if (r.days.includes(wd)) {
      const [fh, fm] = r.from.split(':').map(Number), [th, tm] = r.to.split(':').map(Number);
      for (let m = fh * 60 + fm; m + duration <= th * 60 + tm; m += 60) {
        const s = muscat(date, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); const e = s + duration * 60_000;
        const taken = S.bookings.some(b => b.teacher.id === teacherId && ['pending_payment', 'confirmed', 'in_progress'].includes(b.status) && new Date(b.startsAt).getTime() < e && new Date(b.endsAt).getTime() > s);
        const off = S.timeOff.some((t: any) => new Date(t.startsAt).getTime() < e && new Date(t.endsAt).getTime() > s) && isTeacher();
        list.push({ startsAt: iso(s), endsAt: iso(e), available: s > now && !taken && !off });
      }
    }
    out.push({ date, slots: list });
  }
  return out;
}
function nextSlot(teacherId: number) { for (const d of slots(teacherId, iso(Date.now()), 14, 60)) { const s = d.slots.find((x: any) => x.available); if (s) return s.startsAt; } return null; }

/* ---------- الاختبارات ---------- */
function scoreQuiz(quizId: number, answers: Record<string, any>, duration: number) {
  const key = D.quizAnswers[quizId]; let score = 0, max = 0; const topics: Record<string, { c: number; t: number }> = {};
  const breakdown = Object.entries(key).map(([qid, k]: [string, any]) => {
    max += k.points; const given = answers[qid]; let correct = false;
    if (k.type === 'short') correct = typeof given === 'string' && (k.answer as string[]).map(norm).includes(norm(given));
    else { const want = [...k.answer].sort(); const got = Array.isArray(given) ? [...new Set(given.map(Number))].sort() : []; correct = got.length === want.length && got.every((v, i) => v === want[i]); }
    if (correct) score += k.points; const t = topics[k.topic] ?? (topics[k.topic] = { c: 0, t: 0 }); t.t++; if (correct) t.c++;
    return { questionId: Number(qid), correct, given: given ?? null, answer: k.answer, explanation: k.explanation };
  });
  const percent = max ? Math.round((score / max) * 100) : 0;
  S.attempts[quizId] = (S.attempts[quizId] ?? 0) + 1; save();
  return { attemptId: nextId(), score, maxScore: max, percent, passed: percent >= D.quizzes[quizId].passScore, durationSeconds: duration, breakdown, topics: Object.entries(topics).map(([topic, t]) => ({ topic, percent: Math.round((t.c / t.t) * 100), total: t.t })) };
}

/* ---------- الشراء ---------- */
function resolveItem(type: string, id: number) {
  if (type === 'book') { const b = D.student.books.find((x: any) => x.id === id); return b && { title: b.title, price: b.price, listPrice: b.price, teacherId: b.author.id }; }
  if (type === 'course') { const c = D.student.courses.find((x: any) => x.id === id); return c && { title: c.title, price: c.price, listPrice: c.price, teacherId: c.teacher.id }; }
  if (type === 'lesson') { const b = S.bookings.find(x => x.id === id); return b && { title: `حصة ${b.subject.name} (${b.durationMinutes} د)`, price: b.price, listPrice: b.price, teacherId: b.teacher.id }; }
  if (type === 'package') { for (const p of Object.values(D.teacherProfiles) as any[]) { const pk = p.packages.find((x: any) => x.id === id); if (pk) return { title: `باقة ${pk.lessonsCount} حصص (${pk.durationMinutes} د)`, price: pk.price, listPrice: pk.listPrice, teacherId: p.id, pkg: pk }; } }
  return null;
}
function quote(items: { itemType: string; itemId: number }[], coupon?: string | null) {
  const resolved = items.map(i => ({ ...i, ...resolveItem(i.itemType, i.itemId) })).filter(i => i.title);
  const subtotal = money(resolved.reduce((s, i) => s + i.price, 0));
  const discount = coupon && coupon.toUpperCase() === 'WELCOME10' ? money(subtotal * 0.1) : coupon && coupon.toUpperCase() === 'PHYS20' ? money(resolved.filter(i => i.teacherId === 5).reduce((s, i) => s + i.price, 0) * 0.2) : 0;
  if (coupon && !discount) throw err(400, 'validation_error', 'رمز الخصم غير صحيح');
  return { items: resolved, subtotal, discount, tax: 0, taxRate: 0, total: money(subtotal - discount), currency: 'OMR' };
}
function fulfill(order: any, provider: string) {
  order.status = 'paid'; order.paidAt = iso(Date.now()); order.provider = provider;
  for (const it of order.items) {
    if (it.itemType === 'book' && !S.owned.book.includes(it.itemId)) S.owned.book.push(it.itemId);
    if (it.itemType === 'course' && !S.owned.course.includes(it.itemId)) S.owned.course.push(it.itemId);
    if (it.itemType === 'lesson') { const b = S.bookings.find(x => x.id === it.itemId); if (b) { b.status = 'confirmed'; b.expiresAt = null; } }
    if (it.itemType === 'package') { const r = resolveItem('package', it.itemId) as any; S.packages.push({ id: nextId(), teacher: { id: r.teacherId, name: D.teacherProfiles[r.teacherId].name, avatarUrl: null, verified: true }, lessonsCount: r.pkg.lessonsCount, remaining: r.pkg.lessonsCount, durationMinutes: r.pkg.durationMinutes, mode: r.pkg.mode, expiresAt: null }); }
  }
  S.cart = S.cart.filter(c => !order.items.some((i: any) => i.itemType === c.itemType && i.itemId === c.itemId));
  notify('system', 'تم الشراء', order.items.map((i: any) => i.title).join('، '), { orderId: order.id });
}
function notify(type: string, title: string, body: string | null, data: any = null) { S.notifications.unshift({ id: nextId(), type, title, body, data, readAt: null, createdAt: iso(Date.now()) }); }
function err(status: number, code: string, message: string) { return { status, body: { error: { code, message } } }; }
const ok = (body: any = { ok: true }, status = 200) => ({ status, body });

/* ---------- الموجّه ---------- */
export async function handle(method: string, fullPath: string, body: any): Promise<{ status: number; body: any }> {
  load();
  const [path, qs = ''] = fullPath.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs));
  const m = (re: RegExp) => path.match(re);
  const paginate = (list: any[]) => { const page = Number(q.page || 1), limit = Number(q.limit || 20); return { data: list.slice((page - 1) * limit, page * limit), meta: { total: list.length, page, limit, pages: Math.max(1, Math.ceil(list.length / limit)) } }; };
  const done = (r: { status: number; body: any }) => { save(); return r; };
  let r: any;

  /* الصحة والإعداد */
  if (path === '/health') return ok({ ok: true });
  if (path === '/config') return ok({ paymentProviders: ['mock', 'wallet', 'manual'], devOtp: true, mockPayments: true });
  /* المصادقة */
  if (path === '/auth/otp/request') return ok({ ok: true, target: String(body?.target ?? ''), ttlSeconds: 300, devCode: '000000' });
  if (path === '/auth/otp/verify') {
    if (String(body?.code) !== '000000') return err(400, 'otp_invalid', 'رمز التحقّق غير صحيح');
    const t = String(body?.target ?? '');
    if (t.endsWith('90000010')) S.who = 'student'; else if (t.endsWith('91000001')) S.who = 'teacher';
    else { S.who = 'new'; S.newUser = { id: 999, phone: t.includes('@') ? null : t, email: t.includes('@') ? t : null, displayName: '', avatarUrl: null, roles: ['student'], locale: 'ar', timezone: 'Asia/Muscat', onboardingCompleted: false, student: null, teacher: null, createdAt: iso(Date.now()) }; }
    return done(ok({ user: user(), accessToken: 'demo-access', refreshToken: 'demo-refresh', isNew: S.who === 'new' }));
  }
  if (path === '/auth/refresh') return ok({ accessToken: 'demo-access', refreshToken: 'demo-refresh', user: user() });
  if (path === '/auth/logout') return ok();
  if (path === '/auth/apple' || path === '/auth/google') return err(501, 'content_unavailable', 'يتطلّب ضبط مفاتيح المتاجر');
  if (!S.who) return err(401, 'unauthorized', 'يجب تسجيل الدخول');
  if (path === '/auth/me') return ok(user());
  if (path === '/me' && method === 'PATCH') { const u = user(); if (body?.displayName) u.displayName = body.displayName; if (body?.locale) u.locale = body.locale; return done(ok(u)); }
  if (path === '/me' && method === 'DELETE') { S.who = null; return done(ok()); }
  if (path === '/me/student-setup') { const u = S.who === 'new' ? S.newUser : user(); const g = D.catalog.grades.find((x: any) => x.id === body.gradeId); const sm = D.catalog.semesters.find((x: any) => x.id === body.semesterId);
    u.displayName = body.displayName; u.onboardingCompleted = true; u.student = { curriculumId: body.curriculumId, gradeId: body.gradeId, gradeName: g?.name ?? null, semesterId: body.semesterId, semesterName: sm?.name ?? null, subjectIds: body.subjectIds }; return done(ok(u)); }
  /* المنهج والبحث */
  if (path === '/catalog/tree') return ok(D.catalog);
  if (path === '/catalog/units') return ok(D.units[`${q.subjectId}-${q.gradeId}-${q.semesterId}`] ?? []);
  if (path === '/catalog/search') { const t = norm(q.q ?? ''); return ok({ books: D.student.books.filter((b: any) => norm(b.title).includes(t) || norm(b.subject.name).includes(t)).slice(0, 12).map(bookCard), courses: D.student.courses.filter((c: any) => norm(c.title).includes(t) || norm(c.subject.name).includes(t)).map(courseCard), teachers: D.student.teachers.filter((x: any) => norm(x.name).includes(t) || norm(x.headline ?? '').includes(t) || x.subjects.some((s: any) => norm(s.name).includes(t))).map(teacherCard), lessons: Object.values(D.units).flat().flatMap((u: any) => u.lessons.filter((l: any) => norm(l.title).includes(t)).map((l: any) => ({ id: l.id, title: l.title, unitTitle: u.title, subjectName: D.catalog.subjects.find((s: any) => s.id === u.subjectId)?.name ?? '' }))).slice(0, 10) }); }
  /* الرئيسية والتقدّم */
  if (path === '/home') { const h = isTeacher() ? D.teacher.home : D.student.home; const next = S.bookings.filter(b => ['confirmed', 'in_progress'].includes(b.status) && new Date(b.endsAt).getTime() > Date.now() && (isTeacher() ? b.teacher.id === uid() : true)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    return ok({ ...h, greeting: { ...h.greeting, name: user().displayName || h.greeting.name, gradeName: user().student?.gradeName ?? h.greeting.gradeName, unreadNotifications: S.notifications.filter(n => !n.readAt).length }, nextLesson: next ? bookingView(next) : null, gradeSummaries: h.gradeSummaries.map(bookCard), trending: h.trending.map(bookCard), solvedProblems: h.solvedProblems.map(bookCard), courses: h.courses.map(courseCard), recommendedTeachers: h.recommendedTeachers.map(teacherCard) }); }
  if (path === '/me/progress') return ok(D.student.progress);
  /* الكتب */
  if (path === '/books' && method === 'GET') { let list = D.student.books.slice(); const t = norm(q.q ?? '');
    if (t) list = list.filter((b: any) => norm(b.title).includes(t) || norm(b.subject.name).includes(t)); if (q.gradeId) list = list.filter((b: any) => b.grade.id === Number(q.gradeId)); if (q.subjectId) list = list.filter((b: any) => b.subject.id === Number(q.subjectId)); if (q.type) list = list.filter((b: any) => b.type === q.type); if (q.free === 'true') list = list.filter((b: any) => b.price === 0); if (q.minRating) list = list.filter((b: any) => b.ratingAvg >= Number(q.minRating));
    const sorts: Record<string, (a: any, b: any) => number> = { newest: (a, b) => b.id - a.id, rating: (a, b) => b.ratingAvg - a.ratingAvg, price_asc: (a, b) => a.price - b.price, price_desc: (a, b) => b.price - a.price, bestselling: (a, b) => b.salesCount - a.salesCount || b.ratingAvg - a.ratingAvg }; list.sort(sorts[q.sort ?? 'bestselling'] ?? sorts.bestselling);
    return ok(paginate(list.map(bookCard))); }
  if (path === '/books/mine') return ok(D.teacher.myBooks);
  if ((r = m(/^\/books\/(\d+)$/))) { const d = D.bookDetails[r[1]]; if (!d) return err(404, 'not_found', 'الكتاب غير موجود'); return ok({ ...d, ...bookCard(d), canReview: S.owned.book.includes(d.id) && !S.reviewed.includes(`book:${d.id}`), similar: d.similar.map(bookCard), byAuthor: d.byAuthor.map(bookCard) }); }
  if ((r = m(/^\/books\/(\d+)\/read$/))) { const id = Number(r[1]); const owned = S.owned.book.includes(id) || D.student.books.find((b: any) => b.id === id)?.price === 0; const base = (process.env.EXPO_PUBLIC_API_URL || ''); const rp = S.reading[id];
    return ok({ kind: owned ? 'full' : 'preview', url: `${base}/demo/book-${id}${owned ? '' : '-preview'}.pdf`, expiresAt: iso(Date.now() + 900_000), watermark: owned ? `${user().displayName} — نسخة عرض` : null, lastPage: rp?.lastPage ?? null, bookmarks: rp?.bookmarks ?? [], previewPages: 5 }); }
  if ((r = m(/^\/books\/(\d+)\/progress$/))) { const id = r[1]; S.reading[id] = { ...(S.reading[id] ?? { bookmarks: [] }), lastPage: body.page }; return done(ok()); }
  if ((r = m(/^\/books\/(\d+)\/bookmarks$/))) { const id = r[1]; const cur = S.reading[id] ?? { lastPage: 1, bookmarks: [] }; const set = new Set(cur.bookmarks); set.has(body.page) ? set.delete(body.page) : set.add(body.page); S.reading[id] = { ...cur, bookmarks: [...set].sort((a, b) => a - b) }; return done(ok({ bookmarks: S.reading[id].bookmarks })); }
  /* الدورات والاختبارات */
  if (path === '/courses' && method === 'GET') { let list = D.student.courses.slice(); const t = norm(q.q ?? ''); if (t) list = list.filter((c: any) => norm(c.title).includes(t)); if (q.subjectId) list = list.filter((c: any) => c.subject.id === Number(q.subjectId)); if (q.gradeId) list = list.filter((c: any) => c.grade.id === Number(q.gradeId)); if (q.teacherId) list = list.filter((c: any) => c.teacher.id === Number(q.teacherId)); return ok(paginate(list.map(courseCard))); }
  if (path === '/courses/quick-quiz/pick') return ok({ quizId: 1 });
  if ((r = m(/^\/courses\/quizzes\/(\d+)$/))) { const z = D.quizzes[r[1]]; if (!z) return err(404, 'not_found', 'الاختبار غير موجود'); const { ownerType, ownerId, ...view } = z; if (ownerType === 'course' && !S.owned.course.includes(ownerId)) return err(402, 'payment_required', 'هذا الاختبار ضمن محتوى مدفوع'); return ok({ ...view, attemptsUsed: S.attempts[z.id] ?? 0 }); }
  if ((r = m(/^\/courses\/quizzes\/(\d+)\/submit$/))) { const z = D.quizzes[r[1]]; if (z.attemptsAllowed > 0 && (S.attempts[z.id] ?? 0) >= z.attemptsAllowed) return err(409, 'conflict', 'استنفدت المحاولات'); return done(ok(scoreQuiz(Number(r[1]), body.answers ?? {}, body.durationSeconds ?? 0))); }
  if ((r = m(/^\/courses\/(\d+)$/))) { const d = D.courseDetails[r[1]]; if (!d) return err(404, 'not_found', 'الدورة غير موجودة'); const enrolled = S.owned.course.includes(d.id);
    return ok({ ...d, ...courseCard(d), canReview: enrolled && !S.reviewed.includes(`course:${d.id}`), sections: d.sections.map((s: any) => ({ ...s, lessons: s.lessons.map((l: any) => ({ ...l, locked: !enrolled && !l.isPreview, completed: l.completed || !!S.progress[l.id]?.completed })) })) }); }
  if ((r = m(/^\/courses\/(\d+)\/lessons\/(\d+)$/))) { const pl = D.playLessons[r[1]]?.[r[2]]; const enrolled = S.owned.course.includes(Number(r[1])); if (!pl) { if (!enrolled) return err(402, 'payment_required', 'اشترك في الدورة لمشاهدة هذا الدرس'); return err(404, 'not_found', 'الدرس غير موجود'); } if (!enrolled && !pl.lesson.isPreview) return err(402, 'payment_required', 'اشترك في الدورة لمشاهدة هذا الدرس'); return ok({ ...pl, positionSeconds: S.progress[r[2]]?.pos ?? pl.positionSeconds, lesson: { ...pl.lesson, completed: pl.lesson.completed || !!S.progress[r[2]]?.completed } }); }
  if ((r = m(/^\/courses\/lessons\/(\d+)\/progress$/))) { const cur = S.progress[r[1]] ?? { pos: 0, completed: false }; S.progress[r[1]] = { pos: body.positionSeconds, completed: cur.completed || !!body.completed }; return done(ok({ ok: true, completed: S.progress[r[1]].completed })); }
  /* المعلّمون */
  if (path === '/teachers' && method === 'GET') { let list = D.student.teachers.slice(); const t = norm(q.q ?? ''); if (t) list = list.filter((x: any) => norm(x.name).includes(t) || norm(x.headline ?? '').includes(t) || x.subjects.some((s: any) => norm(s.name).includes(t))); if (q.subjectId) list = list.filter((x: any) => x.subjects.some((s: any) => s.id === Number(q.subjectId))); if (q.maxPrice) list = list.filter((x: any) => x.priceFrom <= Number(q.maxPrice)); if (q.minRating) list = list.filter((x: any) => x.ratingAvg >= Number(q.minRating)); if (q.mode) list = list.filter((x: any) => x.modes.includes(q.mode)); if (q.minYearsExp) list = list.filter((x: any) => x.yearsExp >= Number(q.minYearsExp)); if (q.language) list = list.filter((x: any) => D.teacherProfiles[x.id]?.languages.includes(q.language)); if (q.sort === 'price_asc') list.sort((a: any, b: any) => a.priceFrom - b.priceFrom); if (q.sort === 'rating') list.sort((a: any, b: any) => b.ratingAvg - a.ratingAvg); return ok(paginate(list.map(teacherCard))); }
  if ((r = m(/^\/teachers\/(\d+)$/))) { const p = D.teacherProfiles[r[1]]; if (!p) return err(404, 'not_found', 'المعلّم غير موجود'); return ok({ ...p, ...teacherCard(p), canReview: S.bookings.some(b => b.teacher.id === p.id && b.status === 'completed') && !S.reviewed.includes(`teacher:${p.id}`), books: p.books.map(bookCard), courses: p.courses.map(courseCard), availabilityPreview: slots(p.id, iso(Date.now()), 7, 60).map(d => ({ date: d.date, slotsCount: d.slots.filter((s: any) => s.available).length })) }); }
  if ((r = m(/^\/teachers\/(\d+)\/availability$/))) return ok(slots(Number(r[1]), q.from ?? iso(Date.now()), Number(q.days ?? 14), Number(q.durationMinutes ?? 60)));
  /* الحجوزات */
  if (path === '/bookings' && method === 'POST') { const p = D.teacherProfiles[body.teacherId]; if (!p) return err(400, 'teacher_unavailable', 'المعلّم غير متاح'); const price = p.prices.find((x: any) => x.durationMinutes === body.durationMinutes && x.mode === body.mode)?.price; if (price == null) return err(400, 'validation_error', 'هذه المدة غير متاحة');
    const st = new Date(body.startsAt).getTime(); if (S.bookings.some(b => b.teacher.id === p.id && ['pending_payment', 'confirmed', 'in_progress'].includes(b.status) && new Date(b.startsAt).getTime() < st + body.durationMinutes * 60_000 && new Date(b.endsAt).getTime() > st)) return err(409, 'booking_conflict', 'هذا الموعد لم يعد متاحاً');
    const pkg = body.packagePurchaseId ? S.packages.find(x => x.id === body.packagePurchaseId && x.remaining > 0) : null; if (body.packagePurchaseId && !pkg) return err(400, 'validation_error', 'الباقة غير صالحة');
    const subject = p.subjects.find((s: any) => s.id === body.subjectId) ?? p.subjects[0]; const id = nextId();
    const b = { id, status: pkg ? 'confirmed' : 'pending_payment', mode: body.mode, durationMinutes: body.durationMinutes, startsAt: iso(st), endsAt: iso(st + body.durationMinutes * 60_000), price: pkg ? 0 : price, subject, teacher: { id: p.id, name: p.name, avatarUrl: p.avatarUrl, verified: true }, student: { id: uid(), name: user().displayName, avatarUrl: null, verified: false }, attendance: null, notes: null, createdAt: iso(Date.now()), expiresAt: pkg ? null : iso(Date.now() + 10 * 60_000) };
    S.bookings.push(b); let order: any = null; if (pkg) { pkg.remaining--; notify('booking_confirmed', 'تم تأكيد الحصة', `${subject.name} · ${p.name}`, { bookingId: id }); } else { order = { id: nextId(), number: num(), status: 'pending', subtotal: price, discount: 0, tax: 0, total: price, currency: 'OMR', provider: null, items: [{ itemType: 'lesson', itemId: id, title: `حصة ${subject.name} (${body.durationMinutes} د)`, unitPrice: price, quantity: 1 }], createdAt: iso(Date.now()), paidAt: null, invoiceUrl: null, bookingId: id }; S.orders.unshift(order); }
    return done(ok({ booking: bookingView(b), paymentRequired: !pkg, orderNumber: order?.number ?? null, checkoutUrl: null, expiresAt: b.expiresAt, orderId: order?.id ?? null }, 201)); }
  if (path === '/bookings' && method === 'GET') { const mine = S.bookings.filter(b => q.as === 'teacher' ? b.teacher.id === uid() : b.student.id === uid() || !isTeacher()); const now = Date.now(); const today = muscatDate(now), tomorrow = muscatDate(now + 86_400_000), week = muscatDate(now + 7 * 86_400_000); const up = { today: [] as any[], tomorrow: [] as any[], thisWeek: [] as any[], later: [] as any[] };
    for (const b of mine.filter(b => ['pending_payment', 'confirmed', 'in_progress'].includes(b.status) && new Date(b.endsAt).getTime() >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))) { const k = muscatDate(new Date(b.startsAt).getTime()); (k <= today ? up.today : k === tomorrow ? up.tomorrow : k <= week ? up.thisWeek : up.later).push(bookingView(b)); }
    return ok({ upcoming: up, past: mine.filter(b => !['pending_payment', 'confirmed', 'in_progress'].includes(b.status) || new Date(b.endsAt).getTime() < now).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).map(bookingView), packages: q.as === 'teacher' ? [] : S.packages.filter(p => p.remaining > 0) }); }
  if ((r = m(/^\/bookings\/(\d+)$/))) { const b = S.bookings.find(x => x.id === Number(r[1])); return b ? ok(bookingView(b)) : err(404, 'not_found', 'الحجز غير موجود'); }
  if ((r = m(/^\/bookings\/(\d+)\/cancel$/))) { const b = S.bookings.find(x => x.id === Number(r[1])); if (!b) return err(404, 'not_found', ''); const pct = isTeacher() ? 100 : b.status === 'pending_payment' ? 100 : refundPercent(b.startsAt); b.status = isTeacher() ? 'cancelled_by_teacher' : 'cancelled_by_student'; if (b.price > 0 && pct > 0) { const amt = money(b.price * pct / 100); S.wallet = money(S.wallet + amt); S.walletTx.unshift({ id: nextId(), type: 'refund', amount: amt, balanceAfter: S.wallet, note: `استرجاع حصة ${b.subject.name}`, createdAt: iso(Date.now()) }); notify('refund_processed', 'تم استرجاع المبلغ', `${amt} OMR`, { bookingId: b.id }); } return done(ok({ ok: true, refundPercent: pct })); }
  if ((r = m(/^\/bookings\/(\d+)\/reschedule$/))) { const b = S.bookings.find(x => x.id === Number(r[1])); if (!b) return err(404, 'not_found', ''); const st = new Date(body.startsAt).getTime(); b.startsAt = iso(st); b.endsAt = iso(st + b.durationMinutes * 60_000); return done(ok(bookingView(b))); }
  if ((r = m(/^\/bookings\/(\d+)\/room$/))) { const b = S.bookings.find(x => x.id === Number(r[1])); if (!b) return err(404, 'not_found', ''); const v = bookingView(b); if (!v.canJoin) return err(403, 'content_unavailable', new Date(b.startsAt).getTime() > Date.now() ? 'لم تُفتح القاعة بعد' : 'انتهت الحصة'); b.status = 'in_progress'; return done(ok({ provider: 'internal', roomId: `demo-${b.id}`, token: 'demo', expiresAt: iso(Date.now() + 3 * H), joinUrl: null, realtimeNamespace: '/room', isHost: isTeacher(), booking: bookingView(b) })); }
  if ((r = m(/^\/bookings\/(\d+)\/end$/))) { const b = S.bookings.find(x => x.id === Number(r[1])); if (!b) return err(404, 'not_found', ''); b.status = 'completed'; b.attendance = { studentSeconds: 1500, teacherSeconds: 1560, studentJoinedAt: b.startsAt, teacherJoinedAt: b.startsAt }; return done(ok(bookingView(b))); }
  if ((r = m(/^\/bookings\/(\d+)\/notes$/))) { S.notes[r[1]] = { summary: body.summary, homework: body.homework, attachments: [] }; return done(ok()); }
  /* السلة والدفع */
  const cartView = () => { const items = S.cart.map(c => ({ ...c, ...resolveItem(c.itemType, c.itemId), coverUrl: null, teacherName: D.teacherProfiles[(resolveItem(c.itemType, c.itemId) as any)?.teacherId]?.name ?? null })); let qq: any; try { qq = items.length ? quote(items, S.coupon) : { subtotal: 0, discount: 0, tax: 0, taxRate: 0, total: 0 }; } catch { S.coupon = null; qq = quote(items, null); } return { items, subtotal: qq.subtotal, discount: qq.discount, tax: 0, taxRate: 0, total: qq.total, currency: 'OMR', coupon: S.coupon && qq.discount ? { code: S.coupon.toUpperCase(), type: 'percentage', value: S.coupon.toUpperCase() === 'PHYS20' ? 20 : 10 } : null }; };
  if (path === '/cart' && method === 'GET') return ok(cartView());
  if (path === '/cart/items' && method === 'POST') { if (!S.cart.some(c => c.itemType === body.itemType && c.itemId === body.itemId)) S.cart.push({ id: nextId(), itemType: body.itemType, itemId: body.itemId }); return done(ok(cartView(), 201)); }
  if ((r = m(/^\/cart\/items\/(\d+)$/))) { S.cart = S.cart.filter(c => c.id !== Number(r[1])); return done(ok(cartView())); }
  if (path === '/cart/coupon') { if (body.code) quote(S.cart, body.code); S.coupon = body.code ? String(body.code).toUpperCase() : null; return done(ok(cartView())); }
  if (path === '/checkout/methods') return ok([{ id: 'mock', label: 'بطاقة تجريبية', description: 'نسخة العرض — لا تُخصم أموال', instructions: null }, { id: 'wallet', label: 'الرصيد', description: `الرصيد المتاح: ${S.wallet} OMR`, instructions: null }, { id: 'manual', label: 'تحويل بنكي', description: 'يُفعَّل المحتوى بعد مراجعة التحويل', instructions: { bankName: 'بنك مسقط', iban: 'OM00 0000 0000 0000 0000 0000' } }]);
  if (path === '/checkout/quote') return ok({ ...quote(body.items, body.couponCode), items: quote(body.items, body.couponCode).items.map(i => ({ itemType: i.itemType, itemId: i.itemId, title: i.title, price: i.price, listPrice: i.listPrice })) });
  if (path === '/checkout') { let order: any;
    if (body.bookingId) { order = S.orders.find(o => o.bookingId === body.bookingId && o.status === 'pending'); if (!order) return err(409, 'slot_expired', 'انتهت مهلة إتمام الحجز'); }
    else { const items = body.items?.length ? body.items : S.cart; if (!items.length) return err(400, 'validation_error', 'السلة فارغة'); const qq = quote(items, body.couponCode ?? S.coupon); for (const i of qq.items) if ((i.itemType === 'book' && S.owned.book.includes(i.itemId)) || (i.itemType === 'course' && S.owned.course.includes(i.itemId))) return err(409, 'conflict', `تملك «${i.title}» بالفعل`); order = { id: nextId(), number: num(), status: 'pending', subtotal: qq.subtotal, discount: qq.discount, tax: 0, total: qq.total, currency: 'OMR', provider: null, items: qq.items.map(i => ({ itemType: i.itemType, itemId: i.itemId, title: i.title, unitPrice: i.price, quantity: 1 })), createdAt: iso(Date.now()), paidAt: null, invoiceUrl: null }; S.orders.unshift(order); }
    if (body.provider === 'wallet') { if (S.wallet < order.total) return err(400, 'insufficient_funds', 'الرصيد غير كافٍ'); S.wallet = money(S.wallet - order.total); S.walletTx.unshift({ id: nextId(), type: 'purchase', amount: -order.total, balanceAfter: S.wallet, note: `شراء ${order.number}`, createdAt: iso(Date.now()) }); }
    if (body.provider === 'manual') { order.provider = 'manual'; return done(ok({ order, paid: false, requiresRedirect: false, checkoutUrl: null, awaitingReview: true, instructions: { bankName: 'بنك مسقط', accountName: 'منصّة', iban: 'OM00 0000 0000 0000 0000 0000', amount: String(order.total), reference: order.number } })); }
    fulfill(order, body.provider); return done(ok({ order, paid: true, requiresRedirect: false, checkoutUrl: null, awaitingReview: false })); }
  if (path === '/orders' && method === 'GET') return ok(S.orders.map(orderView));
  if ((r = m(/^\/orders\/([^/]+)$/))) { const o = S.orders.find(x => x.number === r[1] || String(x.id) === r[1]); return o ? ok(orderView(o)) : err(404, 'not_found', 'الطلب غير موجود'); }
  /* حسابي */
  if (path === '/me/purchases') { const p = D.student.purchases; return ok({ books: S.owned.book.map(id => { const b = D.student.books.find((x: any) => x.id === id); return b && { id, title: b.title, coverUrl: null, purchasedAt: p.books.find((x: any) => x.id === id)?.purchasedAt ?? iso(Date.now()) }; }).filter(Boolean), courses: S.owned.course.map(id => { const c = D.student.courses.find((x: any) => x.id === id); return c && { id, title: c.title, coverUrl: null, purchasedAt: iso(Date.now()), progressPercent: courseProgress(id) }; }).filter(Boolean), lessons: S.bookings.map(b => ({ bookingId: b.id, teacherName: b.teacher.name, subjectName: b.subject.name, startsAt: b.startsAt, price: b.price, status: b.status })), subscriptions: [], orders: S.orders }); }
  if (path === '/me/wallet') return ok({ balance: S.wallet, currency: 'OMR', transactions: S.walletTx });
  if (path === '/me/notifications' && method === 'GET') return ok({ data: S.notifications.slice(0, 60), unread: S.notifications.filter(n => !n.readAt).length });
  if (path === '/me/notifications/read') { for (const n of S.notifications) if (!body?.ids || body.ids.includes(n.id)) n.readAt = n.readAt ?? iso(Date.now()); return done(ok({ ok: true, unread: 0 })); }
  if (path === '/me/device-tokens' || path === '/events' || path === '/reports' || m(/^\/blocks\/\d+$/)) return ok(path === '/events' ? null : { ok: true }, path === '/events' ? 204 : 200);
  if (path === '/me/favorites' && method === 'GET') return ok({ books: D.student.books.filter((b: any) => S.fav.book.includes(b.id)).map(bookCard), courses: D.student.courses.filter((c: any) => S.fav.course.includes(c.id)).map(courseCard), teachers: D.student.teachers.filter((t: any) => S.fav.teacher.includes(t.id)).map(teacherCard) });
  if (path === '/me/favorites' && method === 'POST') { const list = S.fav[body.targetType as 'book']; const i = list.indexOf(body.targetId); i >= 0 ? list.splice(i, 1) : list.push(body.targetId); return done(ok({ favorited: i < 0 })); }
  if (path === '/reviews') { S.reviewed.push(`${body.targetType}:${body.targetId}`); if (body.gateRef) S.reviewed.push(`booking:${body.gateRef}`); return done(ok({ ok: true }, 201)); }
  if (path === '/files') return ok({ id: nextId(), url: null, mime: 'application/pdf', size: 1 }, 201);
  /* الرسائل */
  if (path === '/conversations' && method === 'GET') return ok(S.conversations.map(c => ({ ...c, unread: (S.messages[c.id] ?? []).filter(m => m.senderId !== uid() && !m.read).length, lastMessage: (S.messages[c.id] ?? []).slice(-1)[0]?.body ?? null, lastAt: (S.messages[c.id] ?? []).slice(-1)[0]?.createdAt ?? null })));
  if (path === '/conversations' && method === 'POST') { let c = S.conversations.find(x => x.other.id === body.userId); if (!c) { const p = D.teacherProfiles[body.userId]; c = { id: nextId(), other: { id: body.userId, name: p?.name ?? TEACHER_NAME, avatarUrl: null, role: 'teacher' }, lastMessage: null, lastAt: null, unread: 0, context: body.context ?? null }; S.conversations.push(c); S.messages[c.id] = []; } return done(ok(c, 201)); }
  if ((r = m(/^\/conversations\/(\d+)\/messages$/)) && method === 'GET') { for (const x of S.messages[r[1]] ?? []) x.read = true; return ok((S.messages[r[1]] ?? []).map(({ read, ...x }) => x)); }
  if ((r = m(/^\/conversations\/(\d+)\/messages$/)) && method === 'POST') { const cid = Number(r[1]); const msg = { id: nextId(), conversationId: cid, senderId: uid(), kind: 'text', body: body.body, fileUrl: null, replyToId: null, createdAt: iso(Date.now()), read: true }; (S.messages[cid] ??= []).push(msg); const c = S.conversations.find(x => x.id === cid);
    setTimeout(() => { (S.messages[cid] ??= []).push({ id: nextId(), conversationId: cid, senderId: c?.other.id ?? 5, kind: 'text', body: 'أهلاً بك! أنا معك — اكتب سؤالك وسنراجعه معاً في الحصة القادمة إن شاء الله.', fileUrl: null, replyToId: null, createdAt: iso(Date.now()), read: false }); save(); }, 1500);
    const { read, ...out } = msg; return done(ok(out, 201)); }
  /* تطبيق المعلّم */
  if (path === '/teacher/me') { if (S.who === 'new' && !S.teacherApplied) return err(404, 'not_found', 'لم تقدّم طلب انضمام بعد'); if (S.who !== 'teacher') return ok({ verificationStatus: 'pending', monthIncome: 0, todayLessons: 0, upcomingLessons: 0, studentsCount: 0, ratingAvg: 0, availableBalance: 0, booksSold: 0, coursesSold: 0, pendingHomeworkReviews: 0, documents: [], lastDecision: null }); return ok(D.teacher.me); }
  if (path === '/teacher/apply') { S.teacherApplied = true; if (S.newUser) { S.newUser.roles = [...new Set([...S.newUser.roles, 'teacher'])]; S.newUser.teacher = { verificationStatus: 'pending' }; S.newUser.displayName = body.displayName || S.newUser.displayName; } return done(ok({ ok: true, verificationStatus: 'pending' }, 201)); }
  if (path === '/teacher/availability' && method === 'GET') return ok({ rules: S.teacherRules, timeOff: S.timeOff, maxPerDay: 12 });
  if (path === '/teacher/availability' && method === 'PUT') { S.teacherRules = body; return done(ok({ ok: true, count: body.length })); }
  if (path === '/teacher/time-off' && method === 'POST') { const t = { id: nextId(), ...body }; S.timeOff.push(t); return done(ok({ id: t.id, conflictingBookings: [] }, 201)); }
  if ((r = m(/^\/teacher\/time-off\/(\d+)$/))) { S.timeOff = S.timeOff.filter((t: any) => t.id !== Number(r[1])); return done(ok()); }
  if (path === '/teacher/prices' || path === '/teacher/packages') return ok({ ok: true, id: nextId() });
  if (path === '/teacher/earnings') return ok({ ...D.teacher.earnings, available: money(D.teacher.earnings.available - S.payouts.filter((p: any) => !D.teacher.earnings.payouts.includes(p)).reduce((s: number, p: any) => s + p.amount, 0)), payouts: S.payouts });
  if (path === '/teacher/payouts') { if (S.payouts.some((p: any) => p.status === 'pending')) return err(409, 'conflict', 'لديك طلب سحب قيد المعالجة'); S.payouts.unshift({ id: nextId(), amount: body.amount, status: 'pending', requestedAt: iso(Date.now()), processedAt: null }); return done(ok({ id: S.payouts[0].id }, 201)); }
  if (path === '/teacher/bookings') return ok({ upcoming: S.bookings.filter(b => b.teacher.id === uid() && ['confirmed', 'in_progress'].includes(b.status)).map(bookingView), past: D.teacher.bookings.past });
  if (path === '/teacher/students') return ok(D.teacher.students);
  return err(404, 'not_found', `المسار غير موجود في نسخة العرض: ${method} ${path}`);
}

/** محاكاة Socket.IO للقاعة: يدخل الطرف الآخر بعد ثوانٍ، يردّ على الدردشة، ويعكس اليد والسبّورة */
export function createDemoSocket(isHost: boolean, otherName: string, meName: string) {
  const handlers: Record<string, ((...a: any[]) => void)[]> = {};
  const on = (ev: string, cb: (...a: any[]) => void) => { (handlers[ev] ??= []).push(cb); return sock; };
  const fire = (ev: string, ...a: any[]) => (handlers[ev] ?? []).forEach(cb => cb(...a));
  const me = { userId: isHost ? 5 : 10, name: meName, isHost, role: isHost ? 'teacher' : 'student', hand: false, joinedAt: iso(Date.now()) };
  const other = { userId: isHost ? 10 : 5, name: otherName, isHost: !isHost, role: isHost ? 'student' : 'teacher', hand: false, joinedAt: iso(Date.now()) };
  let participants = [me]; let closed = false; const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (ms: number, fn: () => void) => { timers.push(setTimeout(() => { if (!closed) fn(); }, ms)); };
  later(300, () => { fire('connect'); fire('room:welcome', { you: { userId: me.userId, isHost, role: me.role }, participants, messages: [] }); });
  later(2500, () => { participants = [me, other]; fire('presence', participants); });
  later(4000, () => fire('chat:message', { id: 1, userId: other.userId, name: other.name, body: isHost ? 'السلام عليكم أستاذ، جاهز.' : 'أهلاً بك! هذه نسخة عرض — الفيديو الحقيقي يعمل مع الخادم. جرّب الدردشة والسبّورة ورفع اليد.', at: iso(Date.now()) }));
  const sock = {
    on, io: { on: () => sock }, removeAllListeners: () => { for (const k in handlers) delete handlers[k]; }, close: () => { closed = true; timers.forEach(clearTimeout); },
    emit: (ev: string, ...a: any[]) => {
      if (ev === 'chat:send') { const body = a[0]?.body; const ack = a[1]; const id = Date.now(); fire('chat:message', { id, userId: me.userId, name: me.name, body, at: iso(Date.now()) }); ack?.({ ok: true, id }); later(1800, () => fire('chat:message', { id: id + 1, userId: other.userId, name: other.name, body: 'تمام 👍 وصلتني رسالتك.', at: iso(Date.now()) })); }
      if (ev === 'hand:toggle') { me.hand = !!a[0]; fire('presence', participants); }
      if (ev === 'room:end') { fire('room:ended', { by: me.userId }); }
      return sock;
    },
  };
  return sock;
}
