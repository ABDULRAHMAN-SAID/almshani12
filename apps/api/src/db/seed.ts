/**
 * ⚠️  بيانات تطوير فقط — DEV SEED
 * تُنشئ منهجاً عُمانياً حقيقي البنية ومستخدمين وكتباً ودورات وحجوزات عبر مسارات الخدمة نفسها
 * (شراء فعلي بالمحفظة، تقييم مقفل بحجز مكتمل…) حتى تكون كل الأرقام في الواجهة مشتقّة من صفوف حقيقية.
 * لا تُشغَّل في الإنتاج. الإنتاج يبدأ بمنهج فقط (seedCatalog) بلا مستخدمين ولا محتوى.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';
import { db, q, migrate, nowIso } from './index.ts';
import { money, muscatToUtc } from '../lib/helpers.ts';
import { storeFile } from '../services/storage.ts';
import { createOrder, fulfillOrder } from '../services/checkout.ts';
import { grantAccess } from '../services/access.ts';
import * as wallet from '../services/wallet.ts';
import { releaseEarnings } from '../services/earnings.ts';

/* ============================ المنهج (آمن للإنتاج) ============================ */
export function seedCatalog() {
  const om = q.get<{ id: number }>("SELECT id FROM countries WHERE code = 'OM'")?.id
    ?? Number(q.run("INSERT INTO countries (code, name) VALUES ('OM', 'سلطنة عُمان')").lastInsertRowid);
  const cur = q.get<{ id: number }>('SELECT id FROM curriculums WHERE country_id = ? AND name = ?', om, 'التعليم العام — وزارة التربية والتعليم')?.id
    ?? Number(q.run('INSERT INTO curriculums (country_id, name) VALUES (?, ?)', om, 'التعليم العام — وزارة التربية والتعليم').lastInsertRowid);

  const gradeNames: [number, string][] = [[5, 'الصف الخامس'], [6, 'الصف السادس'], [7, 'الصف السابع'], [8, 'الصف الثامن'], [9, 'الصف التاسع'], [10, 'الصف العاشر'], [11, 'الصف الحادي عشر'], [12, 'الصف الثاني عشر (الدبلوم العام)']];
  const grades: Record<number, number> = {};
  for (const [order, name] of gradeNames) {
    grades[order] = q.get<{ id: number }>('SELECT id FROM grades WHERE curriculum_id = ? AND "order" = ?', cur, order)?.id
      ?? Number(q.run('INSERT INTO grades (curriculum_id, name, "order") VALUES (?,?,?)', cur, name, order).lastInsertRowid);
  }
  const semesters: Record<number, number> = {};
  for (const [order, name] of [[1, 'الفصل الدراسي الأول'], [2, 'الفصل الدراسي الثاني']] as [number, string][]) {
    semesters[order] = q.get<{ id: number }>('SELECT id FROM semesters WHERE curriculum_id = ? AND "order" = ?', cur, order)?.id
      ?? Number(q.run('INSERT INTO semesters (curriculum_id, name, "order") VALUES (?,?,?)', cur, name, order).lastInsertRowid);
  }
  const subjectDefs: [string, string, string][] = [
    ['الرياضيات', 'math', 'math'], ['الفيزياء', 'physics', 'physics'], ['الكيمياء', 'chemistry', 'chemistry'], ['الأحياء', 'biology', 'biology'],
    ['اللغة العربية', 'arabic', 'arabic'], ['اللغة الإنجليزية', 'english', 'english'], ['التربية الإسلامية', 'islamic', 'islamic'], ['الدراسات الاجتماعية', 'social', 'social'],
  ];
  const subjects: Record<string, number> = {};
  subjectDefs.forEach(([name, slug, color], i) => {
    subjects[slug] = q.get<{ id: number }>('SELECT id FROM subjects WHERE curriculum_id = ? AND slug = ?', cur, slug)?.id
      ?? Number(q.run('INSERT INTO subjects (curriculum_id, name, slug, color_key, "order") VALUES (?,?,?,?,?)', cur, name, slug, color, i).lastInsertRowid);
  });

  // وحدات الصف الثاني عشر — الفصل الأول (عناوين من بنية المنهج العُماني)
  const units: Record<string, string[][]> = {
    physics: [['الكميّات الفيزيائية والقياس', 'الوحدات والأبعاد', 'الأخطاء وعدم اليقين', 'المتّجهات'], ['الحركة في بُعد واحد', 'الإزاحة والسرعة', 'التسارع المنتظم', 'السقوط الحر'], ['قوانين نيوتن', 'القصور الذاتي', 'القانون الثاني', 'الاحتكاك'], ['الشغل والطاقة', 'الشغل', 'طاقة الحركة والوضع', 'حفظ الطاقة']],
    chemistry: [['بنية الذرة', 'النماذج الذرية', 'التوزيع الإلكتروني', 'الجدول الدوري'], ['الترابط الكيميائي', 'الرابطة الأيونية', 'الرابطة التساهمية', 'أشكال الجزيئات'], ['الحسابات الكيميائية', 'المول', 'الصيغ الكيميائية', 'المعادلات الموزونة'], ['الحالة الغازية', 'قوانين الغازات', 'المعادلة العامة']],
    math: [['الدوال ورسومها', 'الدالة ومجالها', 'التحويلات الهندسية', 'الدوال العكسية'], ['التفاضل', 'النهايات', 'قواعد الاشتقاق', 'تطبيقات المشتقة'], ['المتّجهات', 'العمليات على المتّجهات', 'الضرب القياسي']],
    english: [['Unit 1 — Achievements', 'Present perfect vs past simple', 'Reading: Omani innovators', 'Writing: a biography'], ['Unit 2 — Media', 'Reported speech', 'Listening: news reports', 'Writing: an article'], ['Unit 3 — The environment', 'Conditionals', 'Vocabulary: climate', 'Speaking: debate']],
    arabic: [['النحو: الجملة الاسمية', 'المبتدأ والخبر', 'النواسخ', 'التوابع'], ['البلاغة', 'التشبيه', 'الاستعارة', 'الكناية'], ['الأدب: الشعر العُماني الحديث', 'أبو مسلم البهلاني', 'تحليل نص']],
  };
  for (const [slug, list] of Object.entries(units)) {
    for (const [i, [title, ...lessons]] of list.entries()) {
      const uid = q.get<{ id: number }>('SELECT id FROM units WHERE subject_id = ? AND grade_id = ? AND semester_id = ? AND title = ?', subjects[slug], grades[12], semesters[1], title)?.id
        ?? Number(q.run('INSERT INTO units (subject_id, grade_id, semester_id, title, "order") VALUES (?,?,?,?,?)', subjects[slug], grades[12], semesters[1], title, i).lastInsertRowid);
      lessons.forEach((l, j) => { if (!q.get('SELECT 1 FROM curriculum_lessons WHERE unit_id = ? AND title = ?', uid, l)) q.run('INSERT INTO curriculum_lessons (unit_id, title, "order") VALUES (?,?,?)', uid, l, j); });
    }
  }
  return { countryId: om, curriculumId: cur, grades, semesters, subjects };
}

/* ============================ بيانات التطوير ============================ */
const DEMO_MARK = '+96890000001';

/** PDF صالح بعدد صفحات محدّد (نص لاتيني لأن الخطوط القياسية لا تدعم العربية) */
export function makePdf(title: string, pages: number): Buffer {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = [];
  const pagesId = objs.length + pages * 2 + 1;
  for (let i = 1; i <= pages; i++) {
    const text = `BT /F1 22 Tf 60 770 Td (${title.replace(/[()\\]/g, '')} - page ${i} of ${pages}) Tj ET BT /F1 12 Tf 60 740 Td (Manassah demo content. Not for distribution.) Tj ET`;
    const cId = add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${cId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`));
  }
  const realPagesId = add(`<< /Type /Pages /Kids [${pageIds.map(p => `${p} 0 R`).join(' ')}] /Count ${pages} >>`);
  if (realPagesId !== pagesId) throw new Error('pdf ids');
  const catId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function user(phone: string, name: string, roles: string[], extra: { gender?: 'male' | 'female'; email?: string } = {}) {
  const existing = q.get<{ id: number }>('SELECT id FROM users WHERE phone = ?', phone);
  if (existing) return existing.id;
  const id = Number(q.run('INSERT INTO users (phone, email, onboarding_completed) VALUES (?,?,1)', phone, extra.email ?? null).lastInsertRowid);
  q.run('INSERT INTO profiles (user_id, display_name, gender) VALUES (?,?,?)', id, name, extra.gender ?? null);
  for (const r of roles) q.run('INSERT INTO user_roles (user_id, role) VALUES (?,?)', id, r);
  q.run("INSERT INTO auth_identities (user_id, provider, provider_uid) VALUES (?,'phone_otp',?)", id, phone);
  return id;
}

export function seedDemo() {
  if (config.env === 'production' && !config.bootstrap.allowDemoSeed) throw new Error('seedDemo ممنوع في الإنتاج (اضبط ALLOW_DEMO_SEED=1 لخادم عرض)');
  if (q.get('SELECT 1 FROM users WHERE phone = ?', DEMO_MARK)) return { skipped: true };
  const cat = seedCatalog();
  const G12 = cat.grades[12], G11 = cat.grades[11], S1 = cat.semesters[1];

  /* ---- الطاقم ---- */
  user('+96890000001', 'مدير المنصّة', ['super_admin', 'admin']);
  user('+96890000002', 'قسم المالية', ['finance']);
  user('+96890000003', 'مراجع المحتوى', ['content_reviewer']);
  user('+96890000004', 'الدعم', ['support']);

  /* ---- المعلّمون (معتمدون عبر سجلّ تحقّق حقيقي) ---- */
  const teacherDefs = [
    { phone: '+96891000001', name: 'أ. خالد الهنائي', gender: 'male', subject: 'physics', headline: 'فيزياء الدبلوم العام — ١٢ عاماً في مدارس مسقط', years: 12, prices: [[30, 3], [45, 4.5], [60, 6]], group: [[60, 3]] },
    { phone: '+96891000002', name: 'أ. مريم البلوشية', gender: 'female', subject: 'chemistry', headline: 'كيمياء ١١ و١٢ — شرح مبسّط وحلّ نماذج الوزارة', years: 8, prices: [[30, 2.5], [45, 3.5], [60, 5]], group: [[60, 2.5]] },
    { phone: '+96891000003', name: 'Ms. Sara Al Riyami', gender: 'female', subject: 'english', headline: 'English for Grade 12 — IELTS-style practice', years: 9, prices: [[30, 3], [45, 4], [60, 5.5]], group: [] },
    { phone: '+96891000004', name: 'أ. سعيد المعمري', gender: 'male', subject: 'arabic', headline: 'نحو وبلاغة الدبلوم — تدريب على أسئلة الامتحان', years: 15, prices: [[30, 2], [45, 3], [60, 4]], group: [[60, 2]] },
    { phone: '+96891000005', name: 'أ. أحمد الرواحي', gender: 'male', subject: 'math', headline: 'رياضيات ١١ و١٢ — تفاضل وتكامل خطوة بخطوة', years: 10, prices: [[30, 3], [45, 4.5], [60, 6]], group: [[60, 3]] },
  ] as const;
  const teachers: Record<string, number> = {};
  for (const t of teacherDefs) {
    const id = user(t.phone, t.name, ['teacher', 'student'], { gender: t.gender });
    teachers[t.subject] = id;
    q.run(`INSERT INTO teacher_profiles (user_id, headline, bio, qualification, specialty, years_exp, languages, teaching_style, verification_status, applied_at, verified_at)
           VALUES (?,?,?,?,?,?,?,?,'verified',?,?)`, id, t.headline,
      `${t.headline}. أعتمد على أمثلة من امتحانات الوزارة السابقة، وأرسل ملخّصاً وواجباً بعد كل حصة.`,
      'بكالوريوس تربية', t.headline.split('—')[0].trim(), t.years, JSON.stringify(t.subject === 'english' ? ['en', 'ar'] : ['ar']), JSON.stringify(['شرح مبسّط', 'حلّ نماذج سابقة', 'واجب بعد كل حصة']), nowIso(), nowIso());
    q.run("INSERT INTO teacher_verifications (teacher_id, reviewer_id, decision, reason) VALUES (?,?,'verified','اكتملت المستندات')", id, 1);
    for (const g of [G11, G12]) q.run('INSERT INTO teacher_subjects (teacher_id, subject_id, grade_id) VALUES (?,?,?)', id, cat.subjects[t.subject], g);
    for (const [d, p] of t.prices) q.run("INSERT INTO teacher_prices (teacher_id, duration_minutes, mode, price) VALUES (?,?,'individual',?)", id, d, p);
    for (const [d, p] of t.group) q.run("INSERT INTO teacher_prices (teacher_id, duration_minutes, mode, price) VALUES (?,?,'group',?)", id, d, p);
    // الأحد–الخميس مساءً، السبت صباحاً
    for (const wd of [0, 1, 2, 3, 4]) q.run('INSERT INTO teacher_availability (teacher_id, weekday, start_time, end_time, slot_minutes, break_minutes) VALUES (?,?,?,?,60,0)', id, wd, '16:00', '21:00');
    q.run('INSERT INTO teacher_availability (teacher_id, weekday, start_time, end_time, slot_minutes, break_minutes) VALUES (?,6,?,?,60,0)', id, '10:00', '14:00');
    const unit60 = t.prices.find(p => p[0] === 60)![1];
    q.run("INSERT INTO lesson_packages (teacher_id, lessons_count, duration_minutes, mode, price) VALUES (?,5,60,'individual',?)", id, money(unit60 * 5 * 0.9));
    q.run("INSERT INTO lesson_packages (teacher_id, lessons_count, duration_minutes, mode, price) VALUES (?,10,60,'individual',?)", id, money(unit60 * 10 * 0.8));
  }

  /* ---- الطلاب ---- */
  const student = (phone: string, name: string, grade: number, subjectSlugs: string[]) => {
    const id = user(phone, name, ['student']);
    q.run('INSERT INTO student_profiles (user_id, curriculum_id, grade_id, semester_id, school) VALUES (?,?,?,?,?)', id, cat.curriculumId, grade, S1, 'مدرسة السلطان قابوس');
    for (const s of subjectSlugs) q.run('INSERT INTO student_subjects (user_id, subject_id) VALUES (?,?)', id, cat.subjects[s]);
    wallet.credit(id, 60, { type: 'bonus', note: 'رصيد تجريبي (تطوير)' });
    return id;
  };
  const demo = student('+96890000010', 'عبدالرحمن', G12, ['physics', 'chemistry', 'english', 'arabic']);
  const others = [
    student('+96890000011', 'فاطمة الحارثية', G12, ['chemistry', 'math']), student('+96890000012', 'محمد العامري', G12, ['physics', 'math']),
    student('+96890000013', 'نور السعدية', G11, ['english', 'arabic']), student('+96890000014', 'يوسف الكندي', G12, ['physics', 'english']),
    student('+96890000015', 'ريم المقبالية', G11, ['chemistry', 'arabic']),
  ];

  /* ---- الكتب (ملف كامل + معاينة، إرسال ومراجعة حقيقيان) ---- */
  const bookDefs: { subject: string; type: string; title: string; price: number; pages: number; level?: string; points: string[]; toc: [string, number][]; grade?: number }[] = [
    { subject: 'physics', type: 'summary', title: 'ملخّص الفيزياء — الصف ١٢ الفصل الأول', price: 3.5, pages: 64, points: ['كل قوانين الفصل في صفحة واحدة', 'أمثلة محلولة بعد كل قانون', 'أخطاء شائعة في الامتحان'], toc: [['الكميّات والقياس', 3], ['الحركة في بُعد واحد', 15], ['قوانين نيوتن', 31], ['الشغل والطاقة', 47]] },
    { subject: 'physics', type: 'solved_problems', title: 'حلّ مسائل الفيزياء خطوة بخطوة — الحركة وقوانين نيوتن', price: 2.5, pages: 48, points: ['١٢٠ مسألة بالحل التفصيلي', 'مرتّبة من السهل للصعب'], toc: [['مسائل الحركة', 2], ['مسائل نيوتن', 24]] },
    { subject: 'physics', type: 'exam_models', title: 'نماذج امتحانات الفيزياء ٢٠٢١–٢٠٢٥ مع الحلول', price: 1.5, pages: 40, points: ['٥ نماذج وزارية', 'إجابات نموذجية بتوزيع الدرجات'], toc: [['نموذج ٢٠٢١', 2], ['نموذج ٢٠٢٣', 18], ['نموذج ٢٠٢٥', 32]] },
    { subject: 'physics', type: 'foundation', title: 'تأسيس الفيزياء — ما تحتاجه قبل الصف ١٢', price: 0, pages: 20, points: ['مجاني', 'المتّجهات والوحدات من الصفر'], toc: [['الوحدات', 1], ['المتّجهات', 9]] },
    { subject: 'chemistry', type: 'summary', title: 'ملخّص الكيمياء — الصف ١٢ الفصل الأول', price: 3, pages: 58, points: ['خرائط ذهنية لكل وحدة', 'جداول مقارنة للروابط'], toc: [['بنية الذرة', 2], ['الترابط الكيميائي', 16], ['الحسابات', 34], ['الغازات', 48]] },
    { subject: 'chemistry', type: 'exercises', title: 'تمارين الكيمياء — الحسابات الكيميائية', price: 2, pages: 36, points: ['٨٠ تمريناً متدرّجاً', 'الإجابات في نهاية الكتاب'], toc: [['المول', 2], ['المعادلات', 14], ['الإجابات', 28]] },
    { subject: 'chemistry', type: 'final_review', title: 'المراجعة النهائية — كيمياء ١٢', price: 4, pages: 72, points: ['مراجعة الفصلين في ٧٢ صفحة', 'أسئلة متوقّعة'], toc: [['الفصل الأول', 2], ['الفصل الثاني', 38]] },
    { subject: 'english', type: 'english_book', title: 'Grade 12 English — Reading & Writing Companion', price: 3, pages: 60, points: ['12 model essays', 'Reading strategies for the exam'], toc: [['Reading', 2], ['Writing', 30]] },
    { subject: 'english', type: 'grammar', title: 'English Grammar for the Diploma — with Omani examples', price: 2, pages: 44, points: ['Tenses, reported speech, conditionals', 'Practice after every rule'], toc: [['Tenses', 2], ['Reported speech', 18], ['Conditionals', 32]] },
    { subject: 'english', type: 'vocabulary', title: 'Diploma Vocabulary Builder — 600 words', price: 1.5, pages: 30, points: ['Words grouped by unit', 'Arabic meanings included'], toc: [['Units 1–3', 2], ['Units 4–6', 16]] },
    { subject: 'arabic', type: 'summary', title: 'ملخّص اللغة العربية — نحو وبلاغة الصف ١٢', price: 2.5, pages: 50, points: ['قواعد النحو في جداول', 'الأساليب البلاغية بأمثلة من الشعر العُماني'], toc: [['النحو', 2], ['البلاغة', 26]] },
    { subject: 'arabic', type: 'question_bank', title: 'بنك أسئلة اللغة العربية — ٣٠٠ سؤال بالإجابات', price: 2, pages: 56, points: ['أسئلة على نمط الوزارة', 'إجابات نموذجية'], toc: [['أسئلة النحو', 2], ['أسئلة البلاغة', 30]] },
    { subject: 'math', type: 'summary', title: 'ملخّص الرياضيات — الصف ١٢ الفصل الأول', price: 3.5, pages: 66, points: ['قوانين التفاضل في صفحة', 'أمثلة محلولة'], toc: [['الدوال', 2], ['التفاضل', 24], ['المتّجهات', 50]] },
    { subject: 'math', type: 'solved_problems', title: 'حلّ مسائل التفاضل خطوة بخطوة', price: 2.5, pages: 52, points: ['١٠٠ مسألة محلولة', 'تطبيقات المشتقة'], toc: [['النهايات', 2], ['الاشتقاق', 18], ['التطبيقات', 36]] },
    { subject: 'physics', type: 'summary', title: 'ملخّص الفيزياء — الصف ١١ الفصل الأول', price: 3, pages: 54, grade: G11, points: ['مختصر ومباشر', 'أمثلة محلولة'], toc: [['القياس', 2], ['الحركة', 20]] },
  ];
  const books: number[] = [];
  for (const b of bookDefs) {
    const author = teachers[b.subject];
    const id = Number(q.run(`INSERT INTO books (author_id, title, type, subject_id, grade_id, semester_id, description, learn_points, tags, price, pages, edition, version, language, level, preview_pages, status, published_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?)`, author, b.title, b.type, cat.subjects[b.subject], b.grade ?? G12, S1,
      `${b.title}. مُعدّ وفق كتاب الوزارة الحالي، ومراجَع من فريق المنصّة.`, JSON.stringify(b.points), JSON.stringify([b.type, b.subject]), b.price, b.pages, 'الطبعة ٢٠٢٥', '1.2', b.subject === 'english' ? 'en' : 'ar', b.level ?? null, 5,
      new Date(Date.now() - Math.floor(Math.random() * 40) * 86_400_000).toISOString()).lastInsertRowid);
    b.toc.forEach(([t, p], i) => q.run('INSERT INTO book_toc (book_id, title, page, "order") VALUES (?,?,?,?)', id, t, p, i));
    // الخطوط القياسية في PDF لا تدعم العربية — عنوان لاتيني للملف التجريبي
    const tag = `Manassah demo book ${id} (${b.subject} ${b.type})`;
    const full = storeFile(makePdf(tag, b.pages), { ownerId: author, originalName: `book-${id}.pdf`, mime: 'application/pdf', purpose: 'book' });
    const preview = storeFile(makePdf(`${tag} - preview`, 5), { ownerId: author, originalName: `book-${id}-preview.pdf`, mime: 'application/pdf', purpose: 'book' });
    q.run("INSERT INTO book_files (book_id, kind, file_id) VALUES (?,'full',?)", id, full.id);
    q.run("INSERT INTO book_files (book_id, kind, file_id) VALUES (?,'preview',?)", id, preview.id);
    q.run("INSERT INTO content_reviews (entity_type, entity_id, reviewer_id, decision, checklist) VALUES ('book',?,?,'approved',?)", id, 3, JSON.stringify({ content: true, price: true, file: true, copyright: true }));
    books.push(id);
  }

  /* ---- الاختبارات (وحدات + دورات) ---- */
  const quiz = (ownerType: string, ownerId: number | null, author: number, title: string, qs: any[]) => {
    const id = Number(q.run('INSERT INTO quizzes (owner_type, owner_id, author_id, title, pass_score, time_limit_seconds, attempts_allowed) VALUES (?,?,?,?,60,600,3)', ownerType, ownerId, author, title).lastInsertRowid);
    qs.forEach((x, i) => q.run('INSERT INTO quiz_questions (quiz_id, type, text, options, answer, explanation, topic_tag, points, "order") VALUES (?,?,?,?,?,?,?,?,?)',
      id, x.type, x.text, JSON.stringify(x.type === 'true_false' ? ['صح', 'خطأ'] : x.options ?? []), JSON.stringify(x.answer), x.explanation ?? null, x.topic ?? null, x.points ?? 1, i));
    return id;
  };
  const unitOf = (slug: string, title: string) => q.val<number>('SELECT id FROM units WHERE subject_id = ? AND title = ?', cat.subjects[slug], title)!;
  quiz('unit', unitOf('physics', 'الحركة في بُعد واحد'), teachers.physics, 'اختبار سريع — الحركة في بُعد واحد', [
    { type: 'mcq', text: 'جسم يتحرّك بسرعة ثابتة 10 م/ث لمدة 5 ثوانٍ. ما الإزاحة؟', options: ['2 م', '15 م', '50 م', '0.5 م'], answer: [2], explanation: 'الإزاحة = السرعة × الزمن = 10 × 5 = 50 م', topic: 'السرعة والإزاحة' },
    { type: 'mcq', text: 'وحدة التسارع في النظام الدولي:', options: ['م/ث', 'م/ث²', 'نيوتن', 'م²/ث'], answer: [1], explanation: 'التسارع = تغيّر السرعة ÷ الزمن → م/ث²', topic: 'التسارع' },
    { type: 'true_false', text: 'في السقوط الحر تكون عجلة الجاذبية ثابتة تقريباً وتساوي 9.8 م/ث².', answer: [0], explanation: 'صحيح بإهمال مقاومة الهواء', topic: 'السقوط الحر' },
    { type: 'mcq', text: 'سيارة تبدأ من السكون بتسارع 2 م/ث². سرعتها بعد 4 ثوانٍ:', options: ['2 م/ث', '4 م/ث', '8 م/ث', '16 م/ث'], answer: [2], explanation: 'v = at = 2 × 4 = 8 م/ث', topic: 'التسارع' },
    { type: 'short', text: 'ما اسم الكميّة الفيزيائية التي تساوي التغيّر في الموضع؟', answer: ['الإزاحة', 'الازاحة'], explanation: 'الإزاحة كميّة متّجهة', topic: 'السرعة والإزاحة' },
  ]);
  quiz('unit', unitOf('chemistry', 'الترابط الكيميائي'), teachers.chemistry, 'اختبار سريع — الترابط الكيميائي', [
    { type: 'mcq', text: 'الرابطة في كلوريد الصوديوم NaCl:', options: ['تساهمية', 'أيونية', 'فلزّية', 'هيدروجينية'], answer: [1], explanation: 'انتقال إلكترون من فلز إلى لافلز', topic: 'الرابطة الأيونية' },
    { type: 'mcq', text: 'عدد الأزواج الإلكترونية المشتركة في جزيء الأكسجين O₂:', options: ['1', '2', '3', '4'], answer: [1], explanation: 'رابطة ثنائية = زوجان', topic: 'الرابطة التساهمية' },
    { type: 'true_false', text: 'شكل جزيء الماء خطّي.', answer: [1], explanation: 'شكله منحنٍ (زاوي) بسبب زوجَي الإلكترونات الحرّين', topic: 'أشكال الجزيئات' },
    { type: 'short', text: 'ما نوع الرابطة بين ذرّتين متماثلتين في الكهروسالبية؟', answer: ['تساهمية غير قطبية', 'تساهميه غير قطبيه', 'غير قطبية'], topic: 'الرابطة التساهمية' },
  ]);
  quiz('unit', unitOf('english', 'Unit 2 — Media'), teachers.english, 'Quick quiz — Reported speech', [
    { type: 'mcq', text: 'She said, "I am tired." → She said that she ___ tired.', options: ['is', 'was', 'were', 'be'], answer: [1], explanation: 'Present simple → past simple in reported speech', topic: 'Reported speech' },
    { type: 'mcq', text: '"Will you come?" he asked. → He asked if I ___ come.', options: ['will', 'would', 'shall', 'can'], answer: [1], topic: 'Reported speech' },
    { type: 'true_false', text: 'In reported speech, "tomorrow" usually becomes "the next day".', answer: [0], topic: 'Time expressions' },
  ]);
  quiz('unit', unitOf('arabic', 'النحو: الجملة الاسمية'), teachers.arabic, 'اختبار سريع — المبتدأ والخبر', [
    { type: 'mcq', text: 'إعراب «العلمُ» في: العلمُ نورٌ.', options: ['مبتدأ مرفوع', 'خبر مرفوع', 'فاعل', 'مفعول به'], answer: [0], topic: 'المبتدأ والخبر' },
    { type: 'mcq', text: 'دخلت «إنّ» على الجملة: الطالبُ مجتهدٌ. تصبح:', options: ['إنّ الطالبُ مجتهدٌ', 'إنّ الطالبَ مجتهدٌ', 'إنّ الطالبَ مجتهداً', 'إنّ الطالبِ مجتهدٍ'], answer: [1], explanation: 'إنّ تنصب المبتدأ وترفع الخبر', topic: 'النواسخ' },
    { type: 'true_false', text: '«كان» ترفع المبتدأ وتنصب الخبر.', answer: [0], topic: 'النواسخ' },
  ]);

  /* ---- الدورات ---- */
  const courseDefs = [
    { subject: 'physics', title: 'فيزياء ١٢ — الفصل الأول كاملاً', price: 9, sections: [['الكميّات والقياس', ['الوحدات والأبعاد', 'الأخطاء', 'المتّجهات']], ['الحركة في بُعد واحد', ['الإزاحة والسرعة', 'التسارع المنتظم', 'السقوط الحر']], ['قوانين نيوتن', ['القانون الأول والثاني', 'الاحتكاك', 'مراجعة شاملة']]] },
    { subject: 'chemistry', title: 'كيمياء ١٢ — الترابط والحسابات', price: 7, sections: [['بنية الذرة', ['التوزيع الإلكتروني', 'الجدول الدوري']], ['الترابط الكيميائي', ['الرابطة الأيونية', 'الرابطة التساهمية', 'أشكال الجزيئات']], ['الحسابات', ['المول', 'المعادلات الموزونة']]] },
    { subject: 'english', title: 'Grade 12 English — Grammar & Writing Bootcamp', price: 8, sections: [['Tenses', ['Present perfect vs past simple', 'Future forms']], ['Reported speech', ['Statements', 'Questions']], ['Writing', ['The article', 'The essay']]] },
    { subject: 'math', title: 'التفاضل من الصفر — رياضيات ١٢', price: 9, sections: [['النهايات', ['مفهوم النهاية', 'حساب النهايات']], ['الاشتقاق', ['قواعد الاشتقاق', 'قاعدة السلسلة', 'تطبيقات المشتقة']]] },
  ] as const;
  const courses: number[] = [];
  for (const c of courseDefs) {
    const id = Number(q.run(`INSERT INTO courses (teacher_id, title, subject_id, grade_id, description, learn_points, requirements, price, status, published_at, featured)
      VALUES (?,?,?,?,?,?,?,?,'published',?,1)`, teachers[c.subject], c.title, cat.subjects[c.subject], G12,
      `${c.title}: دروس مسجّلة قصيرة (٨–١٥ دقيقة) مع اختبار بعد كل قسم وملف تمارين.`, JSON.stringify(['فهم المفاهيم لا حفظها', 'حلّ أسئلة الوزارة', 'اختبار بعد كل قسم']), JSON.stringify(['كتاب الوزارة', 'دفتر وقلم']), c.price, nowIso()).lastInsertRowid);
    c.sections.forEach(([title, lessons], si) => {
      const sid = Number(q.run('INSERT INTO course_sections (course_id, title, "order") VALUES (?,?,?)', id, title, si).lastInsertRowid);
      lessons.forEach((l, li) => q.run('INSERT INTO course_lessons (section_id, title, kind, duration_seconds, is_preview, "order") VALUES (?,?,?,?,?,?)', sid, l, 'video', 480 + li * 120, si === 0 && li === 0 ? 1 : 0, li));
      const qz = quiz('course', id, teachers[c.subject], `اختبار ${title}`, [
        { type: 'true_false', text: `راجعت قسم «${title}» كاملاً قبل الاختبار.`, answer: [0], topic: title },
        { type: 'mcq', text: `أي العبارات تلخّص قسم «${title}»؟`, options: ['الفهم قبل الحفظ', 'الحفظ فقط', 'تجاهل الأمثلة', 'لا شيء'], answer: [0], topic: title },
      ]);
      q.run('INSERT INTO course_lessons (section_id, title, kind, quiz_id, duration_seconds, "order") VALUES (?,?,?,?,?,?)', sid, `اختبار ${title}`, 'quiz', qz, 300, lessons.length);
    });
    q.run("INSERT INTO content_reviews (entity_type, entity_id, reviewer_id, decision) VALUES ('course',?,?,'approved')", id, 3);
    courses.push(id);
  }

  /* ---- مشتريات حقيقية عبر المحفظة (تنتج المبيعات والأرباح) ---- */
  const buy = (uid: number, items: { type: 'book' | 'course'; id: number }[]) => {
    const order = createOrder(uid, { items });
    wallet.debit(uid, order.total, { type: 'purchase', refType: 'order', refId: order.id, note: `شراء ${order.number}` });
    fulfillOrder(order.id, { provider: 'wallet', providerRef: `seed_${order.id}` });
    return order.id;
  };
  buy(demo, [{ type: 'book', id: books[0] }, { type: 'book', id: books[4] }]);
  buy(demo, [{ type: 'course', id: courses[0] }]);
  buy(others[0], [{ type: 'book', id: books[4] }, { type: 'book', id: books[5] }]);
  buy(others[1], [{ type: 'book', id: books[0] }, { type: 'book', id: books[1] }, { type: 'course', id: courses[0] }]);
  buy(others[2], [{ type: 'book', id: books[7] }, { type: 'book', id: books[10] }]);
  buy(others[3], [{ type: 'book', id: books[0] }, { type: 'book', id: books[2] }, { type: 'course', id: courses[2] }]);
  buy(others[4], [{ type: 'book', id: books[6] }, { type: 'book', id: books[10] }]);
  grantAccess(demo, 'book', books[3], { source: 'free' });
  // تقدّم القراءة والدورة للطالب التجريبي
  q.run('INSERT INTO reading_progress (user_id, book_id, last_page, bookmarks) VALUES (?,?,?,?)', demo, books[0], 22, JSON.stringify([5, 17]));
  const firstLessons = q.all<{ id: number; duration_seconds: number }>('SELECT l.id, l.duration_seconds FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE cs.course_id = ? ORDER BY cs."order", l."order" LIMIT 4', courses[0]);
  firstLessons.forEach((l, i) => q.run('INSERT INTO lesson_progress (user_id, lesson_id, position_seconds, completed) VALUES (?,?,?,?)', demo, l.id, i < 3 ? l.duration_seconds : 200, i < 3 ? 1 : 0));
  const totalLessons = q.val<number>('SELECT COUNT(*) FROM course_lessons l JOIN course_sections cs ON cs.id = l.section_id WHERE cs.course_id = ?', courses[0])!;
  q.run('UPDATE course_enrollments SET progress_percent = ?, last_lesson_id = ? WHERE user_id = ? AND course_id = ?', Math.round((3 / totalLessons) * 100), firstLessons[3].id, demo, courses[0]);

  /* ---- حصص: مكتملة (بحضور وملاحظات وتقييم) وقادمة ---- */
  const nextWeekday = (from: Date, hour: number) => {
    const d = new Date(from);
    for (let i = 0; i < 7; i++) { const local = new Date(d.getTime() + 4 * 3_600_000); const wd = local.getUTCDay(); if (wd <= 4) { return muscatToUtc(local.toISOString().slice(0, 10), `${String(hour).padStart(2, '0')}:00`); } d.setTime(d.getTime() + 86_400_000); }
    return muscatToUtc(from.toISOString().slice(0, 10), `${hour}:00`);
  };
  const lesson = (studentId: number, teacherId: number, subject: string, startsAt: string, duration: number, price: number, status: string) => {
    const endsAt = new Date(new Date(startsAt).getTime() + duration * 60_000).toISOString();
    const id = Number(q.run(`INSERT INTO bookings (student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price) VALUES (?,?,?,'individual',?,?,?,'pending_payment',?)`,
      studentId, teacherId, cat.subjects[subject], duration, startsAt, endsAt, price).lastInsertRowid);
    const order = createOrder(studentId, { items: [{ type: 'lesson', id }] });
    wallet.debit(studentId, order.total, { type: 'purchase', refType: 'order', refId: order.id, note: `حصة ${subject}` });
    fulfillOrder(order.id, { provider: 'wallet', providerRef: `seed_${order.id}` });
    if (status === 'completed') {
      q.run("UPDATE bookings SET status = 'completed' WHERE id = ?", id);
      q.run("INSERT INTO booking_attendance (booking_id, user_id, role, joined_at, left_at, seconds) VALUES (?,?,'teacher',?,?,?)", id, teacherId, startsAt, endsAt, duration * 60 - 60);
      q.run("INSERT INTO booking_attendance (booking_id, user_id, role, joined_at, left_at, seconds, reconnects) VALUES (?,?,'student',?,?,?,1)", id, studentId, startsAt, endsAt, duration * 60 - 180);
      releaseEarnings({ sourceType: 'lesson', sourceId: id });
      q.run('UPDATE teacher_profiles SET lessons_count = lessons_count + 1 WHERE user_id = ?', teacherId);
    }
    return id;
  };
  const daysAgo = (n: number, hour: number) => muscatToUtc(new Date(Date.now() - n * 86_400_000 + 4 * 3_600_000).toISOString().slice(0, 10), `${hour}:00`);
  const done1 = lesson(demo, teachers.physics, 'physics', daysAgo(6, 17), 60, 6, 'completed');
  q.run('INSERT INTO booking_notes (booking_id, summary, homework) VALUES (?,?,?)', done1, 'راجعنا معادلات الحركة الثلاث وحللنا ٦ مسائل من نموذج ٢٠٢٣.', 'حلّ المسائل ٧–١٢ من كتاب المسائل المحلولة صفحة ٢٠.');
  lesson(demo, teachers.chemistry, 'chemistry', daysAgo(3, 18), 45, 3.5, 'completed');
  lesson(others[1], teachers.physics, 'physics', daysAgo(5, 19), 60, 6, 'completed');
  lesson(others[0], teachers.chemistry, 'chemistry', daysAgo(2, 17), 60, 5, 'completed');
  lesson(others[3], teachers.english, 'english', daysAgo(4, 16), 60, 5.5, 'completed');
  lesson(others[2], teachers.arabic, 'arabic', daysAgo(8, 20), 60, 4, 'completed');
  lesson(others[1], teachers.math, 'math', daysAgo(1, 18), 60, 6, 'completed');
  // القادمة: أول يوم دراسي بعد الغد الساعة ١٧:٠٠
  // حصة تبدأ بعد ٥ دقائق: القاعة مفتوحة فوراً لتجربة الكاميرا والمايك على خادم العرض
  lesson(demo, teachers.physics, 'physics', new Date(Date.now() + 5 * 60_000).toISOString(), 60, 6, 'confirmed');
  lesson(demo, teachers.physics, 'physics', nextWeekday(new Date(Date.now() + 86_400_000), 17), 60, 6, 'confirmed');
  lesson(others[1], teachers.physics, 'physics', nextWeekday(new Date(Date.now() + 2 * 86_400_000), 18), 60, 6, 'confirmed');
  // تعديل رصيد الأرباح ليعكس الحصص المكتملة
  for (const t of Object.values(teachers)) q.run('UPDATE teacher_profiles SET students_count = (SELECT COUNT(DISTINCT student_id) FROM bookings WHERE teacher_id = ? AND status = ?) WHERE user_id = ?', t, 'completed', t);

  /* ---- تقييمات مقفلة بتجارب حقيقية ---- */
  const review = (uid: number, type: string, targetId: number, rating: number, comment: string) => {
    let gate: [string, number] | null = null;
    if (type === 'teacher') { const b = q.get<any>("SELECT id FROM bookings WHERE student_id = ? AND teacher_id = ? AND status = 'completed'", uid, targetId); if (b) gate = ['booking', b.id]; }
    else { const e = q.get<any>('SELECT id FROM entitlements WHERE user_id = ? AND item_type = ? AND item_id = ?', uid, type, targetId); if (e) gate = [type === 'course' ? 'enrollment' : 'order', e.id]; }
    if (!gate) return;
    q.run('INSERT OR IGNORE INTO reviews (user_id, target_type, target_id, rating, comment, gate_type, gate_id) VALUES (?,?,?,?,?,?,?)', uid, type, targetId, rating, comment, gate[0], gate[1]);
    const table = type === 'teacher' ? 'teacher_profiles' : type === 'book' ? 'books' : 'courses';
    q.run(`UPDATE ${table} SET rating_avg = (SELECT AVG(rating) FROM reviews WHERE target_type = ? AND target_id = ?), rating_count = (SELECT COUNT(*) FROM reviews WHERE target_type = ? AND target_id = ?) WHERE ${type === 'teacher' ? 'user_id' : 'id'} = ?`, type, targetId, type, targetId, targetId);
  };
  review(demo, 'teacher', teachers.physics, 5, 'شرح واضح وحلّ معي نماذج الوزارة. أرسل ملخّصاً بعد الحصة.');
  review(others[1], 'teacher', teachers.physics, 5, 'أفضل معلّم فيزياء جرّبته، صبور ويشرح بالأمثلة.');
  review(others[0], 'teacher', teachers.chemistry, 4, 'ممتازة في الحسابات الكيميائية.');
  review(others[3], 'teacher', teachers.english, 5, 'Very helpful for writing tasks.');
  review(others[2], 'teacher', teachers.arabic, 4, 'إعراب ممتاز وتدريب على نمط الامتحان.');
  review(others[1], 'teacher', teachers.math, 5, 'التفاضل صار سهلاً.');
  review(demo, 'book', books[0], 5, 'ملخّص مرتّب وكل القوانين في مكان واحد.');
  review(others[1], 'book', books[0], 4, 'جيد جداً، ينقصه المزيد من الأمثلة.');
  review(others[3], 'book', books[0], 5, 'اشتريته قبل الامتحان بأسبوع وكفاني.');
  review(others[0], 'book', books[4], 5, 'الخرائط الذهنية ممتازة.');
  review(others[2], 'book', books[10], 4, 'مفيد للنحو.');
  review(demo, 'course', courses[0], 5, 'الدروس قصيرة ومركّزة.');
  review(others[1], 'course', courses[0], 4, 'ممتاز، أتمنى إضافة المزيد من التمارين.');

  /* ---- عرض عام ---- */
  q.run("INSERT OR IGNORE INTO coupons (code, type, value, usage_limit, user_limit, scope, active, ends_at) VALUES ('WELCOME10','percentage',10,500,1,?,1,?)",
    JSON.stringify({ featured: true, title: 'خصم ١٠٪ على أول طلب' }), new Date(Date.now() + 60 * 86_400_000).toISOString());
  q.run("INSERT OR IGNORE INTO coupons (code, type, value, user_limit, scope, active) VALUES ('PHYS20','percentage',20,1,?,1)", JSON.stringify({ teacherId: teachers.physics }));

  return { skipped: false, demoStudent: '+96890000010', admin: DEMO_MARK, otp: config.otp.devCode };
}

/**
 * الإقلاع الأول على خادم فارغ (لا مستخدمين):
 * ALLOW_DEMO_SEED=1 → بيانات العرض كاملة؛ وإلا المنهج فقط + حساب مدير أوّل من ADMIN_PHONE (يدخل برمز التحقّق).
 */
export function bootstrapIfEmpty(): { seeded: 'demo' | 'catalog' | 'none'; admin: string | null } {
  if ((q.val<number>('SELECT COUNT(*) FROM users') ?? 0) > 0) return { seeded: 'none', admin: null };
  return db.transaction(() => {
    if (config.bootstrap.allowDemoSeed) { seedDemo(); return { seeded: 'demo' as const, admin: null }; }
    seedCatalog();
    let admin: string | null = null;
    if (config.bootstrap.adminPhone) {
      const phone = config.bootstrap.adminPhone.startsWith('+') ? config.bootstrap.adminPhone : `+968${config.bootstrap.adminPhone.replace(/\D/g, '').slice(-8)}`;
      user(phone, 'مدير المنصّة', ['super_admin', 'admin']);
      admin = phone;
    }
    return { seeded: 'catalog' as const, admin };
  })();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  migrate();
  const r = db.transaction(() => process.argv.includes('--catalog-only') ? seedCatalog() : seedDemo())();
  console.log(JSON.stringify(r, null, 2));
  console.log(`users: ${q.val('SELECT COUNT(*) FROM users')}  books: ${q.val('SELECT COUNT(*) FROM books')}  courses: ${q.val('SELECT COUNT(*) FROM courses')}  bookings: ${q.val('SELECT COUNT(*) FROM bookings')}`);
}
