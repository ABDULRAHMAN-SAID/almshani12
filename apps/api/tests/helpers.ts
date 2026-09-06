/** أدوات الاختبار: خادم حقيقي على منفذ عشوائي وقاعدة بيانات في الذاكرة لكل ملف اختبار */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data', `test-${process.pid}`);
process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';
process.env.DATA_DIR = dataDir;
process.env.STORAGE_DIR = path.join(dataDir, 'storage');
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SIGNING_SECRET = 'test-signing-secret';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.THAWANI_WEBHOOK_SECRET = 'thawani_test';
process.env.PAYMENT_PROVIDERS = 'mock,wallet,manual';

export type Ctx = Awaited<ReturnType<typeof boot>>;

export async function boot() {
  const app = await import('../src/index.ts');
  const dbm = await import('../src/db/index.ts');
  const seed = await import('../src/db/seed.ts');
  const helpers = await import('../src/lib/helpers.ts');
  const storage = await import('../src/services/storage.ts');
  const learners = await import('../src/services/learners.ts');
  const { server } = app.createApp();
  const cat = seed.seedCatalog();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const q = dbm.q, settings = dbm.settings;

  async function api(pathname: string, { method = 'GET', body, token, headers = {} }: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
    const res = await fetch(base + pathname, {
      method, headers: { ...(body !== undefined && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* غير JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  async function login(phone: string) {
    await api('/api/auth/otp/request', { method: 'POST', body: { channel: 'phone', target: phone } });
    const r = await api('/api/auth/otp/verify', { method: 'POST', body: { channel: 'phone', target: phone, code: '000000' } });
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${r.text}`);
    return { token: r.json.accessToken as string, refreshToken: r.json.refreshToken as string, user: r.json.user, id: r.json.user.id as number };
  }
  const grantRole = (userId: number, role: string) => q.run('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?,?)', userId, role);
  /** متعلّم بالشكل نفسه الذي يبذره seed.ts (position = عدد المتعلّمين الحاليين) */
  function addLearner(accountId: number, name: string, { isSelf, grade = 12, subjects = ['physics'], gender = null }: { isSelf: boolean; grade?: number; subjects?: string[]; gender?: 'male' | 'female' | null }) {
    const position = q.val<number>('SELECT COUNT(*) FROM learners WHERE account_id = ? AND archived_at IS NULL', accountId) ?? 0;
    const id = Number(q.run('INSERT INTO learners (account_id, display_name, gender, is_self, curriculum_id, grade_id, semester_id, position) VALUES (?,?,?,?,?,?,?,?)',
      accountId, name, gender, isSelf ? 1 : 0, cat.curriculumId, cat.grades[grade], cat.semesters[1], position).lastInsertRowid);
    for (const sub of subjects) q.run('INSERT OR IGNORE INTO learner_subjects (learner_id, subject_id) VALUES (?,?)', id, cat.subjects[sub]);
    return id;
  }
  /** طالب: حساب + متعلّم ذاتي واحد (نشط) — الجدولان القديمان يُكتبان انعكاساً كما في الخدمة */
  async function student(phone: string, opts: { grade?: number; subjects?: string[] } = {}) {
    const s = await login(phone);
    const name = `طالب ${phone.slice(-3)}`;
    q.run('UPDATE profiles SET display_name = ? WHERE user_id = ?', name, s.id);
    const learnerId = addLearner(s.id, name, { isSelf: true, grade: opts.grade, subjects: opts.subjects });
    q.run('UPDATE users SET active_learner_id = ?, onboarding_completed = 1 WHERE id = ?', learnerId, s.id);
    learners.projectSelfLearner(s.id);
    return { ...s, learnerId };
  }
  /** وليّ أمر: دور parent فقط، ومتعلّم غير ذاتي لكل ابن (الأول هو النشط) */
  async function parent(phone: string, children: { name: string; grade: number; subjects: string[] }[]) {
    const p = await login(phone);
    q.run('UPDATE profiles SET display_name = ? WHERE user_id = ?', `وليّ أمر ${phone.slice(-3)}`, p.id);
    q.run("DELETE FROM user_roles WHERE user_id = ? AND role = 'student'", p.id);
    grantRole(p.id, 'parent');
    const learnerIds = children.map(ch => addLearner(p.id, ch.name, { isSelf: false, grade: ch.grade, subjects: ch.subjects }));
    q.run('UPDATE users SET active_learner_id = ?, onboarding_completed = 1 WHERE id = ?', learnerIds[0] ?? null, p.id);
    learners.projectSelfLearner(p.id);
    return { ...(await login(phone)), learnerIds }; // رمز جديد يحمل الدور
  }
  async function staff(phone: string, role: string) {
    const s = await login(phone);
    grantRole(s.id, role);
    return login(phone); // رمز جديد يحمل الدور
  }
  /** معلّم بحالة معيّنة مع توفّر ٢٤/٧ وأسعار قياسية */
  async function teacher(phone: string, { status = 'verified', subject = 'physics', allDay = true }: { status?: string; subject?: string; allDay?: boolean } = {}) {
    const t = await login(phone);
    q.run('UPDATE profiles SET display_name = ? WHERE user_id = ?', `معلّم ${phone.slice(-3)}`, t.id);
    grantRole(t.id, 'teacher');
    q.run("INSERT OR REPLACE INTO teacher_profiles (user_id, headline, bio, years_exp, verification_status, verified_at) VALUES (?,?,?,?,?,?)", t.id, 'معلّم اختبار', 'سيرة', 5, status, status === 'verified' ? new Date().toISOString() : null);
    q.run('INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id, grade_id) VALUES (?,?,?)', t.id, cat.subjects[subject], cat.grades[12]);
    for (const [d, p] of [[30, 3], [45, 4.5], [60, 6]]) q.run("INSERT OR REPLACE INTO teacher_prices (teacher_id, duration_minutes, mode, price) VALUES (?,?,'individual',?)", t.id, d, p);
    if (allDay) for (let wd = 0; wd < 7; wd++) q.run('INSERT INTO teacher_availability (teacher_id, weekday, start_time, end_time, slot_minutes, break_minutes) VALUES (?,?,?,?,60,0)', t.id, wd, '00:00', '24:00');
    return login(phone);
  }
  function book(authorId: number, { price = 3, withPreview = true, type = 'summary', status = 'published' } = {}) {
    const id = Number(q.run(`INSERT INTO books (author_id, title, type, subject_id, grade_id, semester_id, price, pages, status, published_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      authorId, `كتاب ${type} ${price}`, type, cat.subjects.physics, cat.grades[12], cat.semesters[1], price, 20, status, new Date().toISOString()).lastInsertRowid);
    const full = storage.storeFile(seed.makePdf('full', 20), { ownerId: authorId, originalName: 'full.pdf', mime: 'application/pdf', purpose: 'book' });
    q.run("INSERT INTO book_files (book_id, kind, file_id) VALUES (?,'full',?)", id, full.id);
    if (withPreview) {
      const prev = storage.storeFile(seed.makePdf('preview', 3), { ownerId: authorId, originalName: 'preview.pdf', mime: 'application/pdf', purpose: 'book' });
      q.run("INSERT INTO book_files (book_id, kind, file_id) VALUES (?,'preview',?)", id, prev.id);
    }
    return id;
  }
  function course(teacherId: number, { price = 9 } = {}) {
    const id = Number(q.run(`INSERT INTO courses (teacher_id, title, subject_id, grade_id, price, status, published_at) VALUES (?,?,?,?,?,'published',?)`, teacherId, 'دورة اختبار', cat.subjects.physics, cat.grades[12], price, new Date().toISOString()).lastInsertRowid);
    const sec = Number(q.run('INSERT INTO course_sections (course_id, title) VALUES (?,?)', id, 'قسم').lastInsertRowid);
    const l1 = Number(q.run("INSERT INTO course_lessons (section_id, title, kind, duration_seconds, is_preview, \"order\") VALUES (?,?,'video',600,1,0)", sec, 'درس معاينة').lastInsertRowid);
    const l2 = Number(q.run("INSERT INTO course_lessons (section_id, title, kind, duration_seconds, is_preview, \"order\") VALUES (?,?,'video',600,0,1)", sec, 'درس مقفل').lastInsertRowid);
    return { id, previewLessonId: l1, lockedLessonId: l2 };
  }
  /** موعد بعد N ساعة، مقرّب لبداية ساعة بتوقيت مسقط */
  const slotIn = (hours: number) => { const d = new Date(Date.now() + hours * 3_600_000); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };
  function close() { server.close(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* تجاهل */ } }
  return { base, api, login, student, parent, addLearner, staff, teacher, book, course, grantRole, slotIn, q, settings, cat, helpers, close, db: dbm.db };
}
