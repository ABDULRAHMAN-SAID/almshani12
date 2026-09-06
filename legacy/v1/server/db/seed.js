import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import config from '../config.js';
import { db, migrate, q, settings } from './database.js';
import { slugify, randomCode, addDays, addMinutes, nowIso, toJson } from '../utils/helpers.js';

const reset = process.argv.includes('--reset');
if (reset) {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(config.db.file + suffix); } catch {}
  }
  console.log('🗑️  حُذفت قاعدة البيانات القديمة');
  process.exit(0);   // أعد تشغيل `npm run seed` لبناء قاعدة جديدة
}

migrate();
const hash = (p) => bcrypt.hashSync(p, 8);
const PASSWORD = config.seedPassword;

console.log('🌱 تعبئة البيانات التجريبية...');

db.transaction(() => {
  /* ------------------------- التصنيفات ------------------------- */
  const categories = [
    ['البرمجة وتقنية المعلومات', '💻'], ['اللغات', '🗣️'], ['التطوير الذاتي', '🌱'],
    ['إدارة الأعمال', '📈'], ['التصميم', '🎨'], ['العلوم الشرعية', '🕌'],
    ['الرياضيات والعلوم', '🔬'], ['المال والاستثمار', '💰'],
  ];
  const categoryIds = {};
  categories.forEach(([name, icon], i) => {
    const existing = q.get('SELECT id FROM categories WHERE name = ?', name);
    categoryIds[name] = existing?.id ?? q.run(
      'INSERT INTO categories (name, slug, icon, position) VALUES (?,?,?,?)',
      name, slugify(name), icon, i).lastInsertRowid;
  });

  /* ------------------------- الباقات ------------------------- */
  const plans = [
    { name: 'الأساسية', price: 4.9, interval: 'month',
      description: 'وصول كامل لكل ملخّصات الكتب',
      features: ['كل ملخّصات الكتب', 'قارئ ومستمع', 'ملاحظات شخصية', 'إلغاء في أي وقت'],
      includes: { summaries: true, courses: false, live_discount: 0.1 } },
    { name: 'المحترفة', price: 12.9, interval: 'month',
      description: 'كل الدورات المسجّلة + الملخّصات + خصم على الحصص المباشرة',
      features: ['كل الدورات المسجّلة', 'كل ملخّصات الكتب', 'خصم ٢٥٪ على الحصص المباشرة', 'شهادات إتمام', 'دعم ذو أولوية'],
      includes: { summaries: true, courses: true, live_discount: 0.25 } },
    { name: 'السنوية', price: 119, interval: 'year',
      description: 'كل مزايا المحترفة بخصم شهرين',
      features: ['كل مزايا الباقة المحترفة', 'توفير شهرين', 'حصة استشارية شهرية', 'وصول مبكر للمحتوى الجديد'],
      includes: { summaries: true, courses: true, live_discount: 0.3 } },
  ];
  plans.forEach((plan, i) => {
    if (q.get('SELECT id FROM plans WHERE slug = ?', slugify(plan.name))) return;
    q.run('INSERT INTO plans (name, slug, description, price, interval, features, includes, position) VALUES (?,?,?,?,?,?,?,?)',
      plan.name, slugify(plan.name), plan.description, plan.price, plan.interval,
      toJson(plan.features), toJson(plan.includes), i);
  });

  /* ------------------------- المستخدمون ------------------------- */
  const user = (name, email, role, extra = {}) => {
    const existing = q.get('SELECT * FROM users WHERE email = ?', email);
    if (existing) return existing.id;
    const info = q.run(
      `INSERT INTO users (name, email, password_hash, role, bio, avatar, email_verified, referral_code, wallet_balance)
       VALUES (?,?,?,?,?,?,1,?,?)`,
      name, email, hash(PASSWORD), role, extra.bio ?? null, extra.avatar ?? null,
      randomCode(8), extra.wallet ?? 0);
    return info.lastInsertRowid;
  };

  const adminId = user('مدير المنصّة', 'admin@manassah.om', 'admin');
  const instructor1 = user('د. عبدالرحمن المعشني', 'abdulrahman@manassah.om', 'instructor',
    { bio: 'مهندس برمجيات ومدرّب معتمد، أُدرّس البرمجة منذ ٢٠١٥.' });
  const instructor2 = user('أ. سالم بن خميس', 'salem@manassah.om', 'instructor',
    { bio: 'مستشار في إدارة الأعمال وريادة المشاريع الصغيرة.' });
  const instructor3 = user('أ. مريم الحارثية', 'maryam@manassah.om', 'instructor',
    { bio: 'مدرّبة لغة إنجليزية ومُعِدّة ملخّصات كتب التطوير الذاتي.' });
  const student1 = user('طالب تجريبي', 'student@manassah.om', 'student', { wallet: 50 });
  user('نورة الشحية', 'noura@manassah.om', 'student', { wallet: 15 });

  const instructorProfile = (id, title, specialty, years) => {
    q.run(
      `INSERT INTO instructor_profiles (user_id, title, specialty, headline, years_exp, approved, commission_rate, applied_at)
       VALUES (?,?,?,?,?,1,?,?)
       ON CONFLICT(user_id) DO UPDATE SET approved = 1, title = excluded.title`,
      id, title, specialty, `${title} — خبرة ${years} سنوات`, years, config.money.commissionRate, nowIso());
  };
  instructorProfile(instructor1, 'مهندس برمجيات', 'البرمجة وتقنية المعلومات', 9);
  instructorProfile(instructor2, 'مستشار أعمال', 'إدارة الأعمال', 12);
  instructorProfile(instructor3, 'مدرّبة لغات', 'اللغات', 7);

  /* ------------------------- الدورات ------------------------- */
  const courses = [
    {
      instructor: instructor1, category: 'البرمجة وتقنية المعلومات',
      title: 'أساسيات البرمجة بلغة JavaScript',
      subtitle: 'من الصفر إلى بناء أول تطبيق ويب تفاعلي',
      description: 'دورة عملية تبدأ من المتغيّرات والدوال وتنتهي ببناء تطبيق كامل يتصل بواجهة برمجية. كل درس مصحوب بتمارين وحلول.',
      level: 'beginner', type: 'recorded', price: 19.9, discount_price: 12.9,
      outcomes: ['كتابة كود JavaScript نظيف', 'التعامل مع DOM والأحداث', 'استهلاك واجهات API', 'بناء مشروع متكامل للمعرض الشخصي'],
      requirements: ['حاسوب متصل بالإنترنت', 'لا تحتاج خبرة برمجية سابقة'],
      sections: [
        { title: 'البداية', lessons: [
          ['ما هي البرمجة ولماذا JavaScript؟', 'video', 480, true],
          ['تهيئة بيئة العمل', 'video', 620, true],
          ['المتغيّرات وأنواع البيانات', 'video', 900, false],
        ]},
        { title: 'المنطق والدوال', lessons: [
          ['الشروط والحلقات', 'video', 1100, false],
          ['الدوال والنطاقات', 'video', 980, false],
          ['تمارين تطبيقية', 'article', 600, false],
        ]},
        { title: 'المشروع العملي', lessons: [
          ['التعامل مع DOM', 'video', 1300, false],
          ['الاتصال بواجهة API', 'video', 1500, false],
          ['نشر المشروع', 'video', 700, false],
        ]},
      ],
    },
    {
      instructor: instructor2, category: 'إدارة الأعمال',
      title: 'ابدأ مشروعك الصغير في ٣٠ يوماً',
      subtitle: 'خطة عملية للتحقّق من الفكرة وأول عميل',
      description: 'منهج تطبيقي يأخذك من الفكرة إلى أول عملية بيع: دراسة السوق، التسعير، التسويق بميزانية محدودة، والتسجيل النظامي.',
      level: 'all', type: 'hybrid', price: 24.9,
      outcomes: ['التحقّق من فكرة مشروعك قبل الإنفاق', 'بناء نموذج عمل واضح', 'تسعير منتجك بثقة', 'الحصول على أول ١٠ عملاء'],
      requirements: ['دفتر ملاحظات ورغبة في التنفيذ'],
      sections: [
        { title: 'الفكرة والسوق', lessons: [
          ['كيف تختبر فكرتك في أسبوع', 'video', 800, true],
          ['تحليل المنافسين عملياً', 'video', 750, false],
        ]},
        { title: 'المال والتسعير', lessons: [
          ['بناء نموذج التكاليف', 'video', 900, false],
          ['استراتيجيات التسعير', 'video', 850, false],
        ]},
        { title: 'أول عميل', lessons: [
          ['التسويق بميزانية صفرية', 'video', 1000, false],
          ['إغلاق أول صفقة', 'video', 700, false],
        ]},
      ],
    },
    {
      instructor: instructor3, category: 'اللغات',
      title: 'الإنجليزية للمحادثة اليومية',
      subtitle: 'تحدّث بثقة في ٨ أسابيع',
      description: 'دورة تركّز على المحادثة الفعلية: مواقف الحياة اليومية، النطق، والمفردات الأكثر استخداماً.',
      level: 'beginner', type: 'live', price: 0,
      outcomes: ['إجراء محادثة يومية بثقة', 'تحسين النطق', '٥٠٠ مفردة عملية'],
      requirements: ['معرفة أساسية بالحروف الإنجليزية'],
      sections: [
        { title: 'التعارف والتحية', lessons: [
          ['عبارات التعريف بالنفس', 'video', 600, true],
          ['أسئلة التعارف الشائعة', 'video', 700, true],
        ]},
      ],
    },
  ];

  const courseIds = [];
  for (const course of courses) {
    if (q.get('SELECT id FROM courses WHERE title = ?', course.title)) continue;
    const info = q.run(
      `INSERT INTO courses (instructor_id, category_id, title, slug, subtitle, description, level, type,
                            price, discount_price, outcomes, requirements, status, published_at, featured, thumbnail)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'published', ?, 1, ?)`,
      course.instructor, categoryIds[course.category], course.title, slugify(course.title), course.subtitle,
      course.description, course.level, course.type, course.price, course.discount_price ?? null,
      toJson(course.outcomes), toJson(course.requirements), nowIso(), null);
    const courseId = info.lastInsertRowid;
    courseIds.push(courseId);

    let position = 0;
    course.sections.forEach((section, si) => {
      const sectionId = q.run('INSERT INTO sections (course_id, title, position) VALUES (?,?,?)',
        courseId, section.title, si).lastInsertRowid;
      for (const [title, type, duration, free] of section.lessons) {
        q.run(
          `INSERT INTO lessons (course_id, section_id, title, type, duration_seconds, position, is_free_preview, content_text, content_url)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          courseId, sectionId, title, type, duration, position++, free ? 1 : 0,
          type === 'article' ? `# ${title}\n\nمحتوى الدرس التطبيقي مع أمثلة وتمارين.` : null,
          type === 'video' ? 'https://cdn.example.com/video-placeholder.mp4' : null);
      }
    });

    // اختبار مقيَّم لكل دورة
    const quizId = q.run(
      `INSERT INTO quizzes (course_id, instructor_id, title, description, mode, pass_score, attempts_allowed)
       VALUES (?,?,?,?, 'graded', 60, 3)`,
      courseId, course.instructor, `اختبار: ${course.title}`, 'اختبار قصير لقياس استيعابك').lastInsertRowid;

    const quizQuestions = [
      ['ما الهدف الأساسي من هذه الدورة؟', ['الترفيه', course.outcomes[0], 'الحصول على وظيفة فوراً', 'لا شيء'], [1]],
      ['هل تحتاج خبرة سابقة لبدء هذه الدورة؟', ['نعم بالضرورة', 'لا، تبدأ من الأساسيات'], [1]],
      ['أي مما يلي من مخرجات الدورة؟', course.outcomes.slice(0, 3).concat(['لا شيء مما سبق']), [0, 1]],
    ];
    quizQuestions.forEach(([text, options, correct], i) => {
      q.run(
        `INSERT INTO quiz_questions (quiz_id, text, type, options, correct, points, explanation, position)
         VALUES (?,?,?,?,?,?,?,?)`,
        quizId, text, correct.length > 1 ? 'multi' : 'single', toJson(options), toJson(correct), 1,
        'راجع دروس الدورة لمزيد من التفاصيل.', i);
    });
  }

  /* ------------------------- الحصص المباشرة ------------------------- */
  const liveSessions = [
    { instructor: instructor1, course: courseIds[0], title: 'ورشة مباشرة: بناء واجهة API بالكامل',
      description: 'ورشة تطبيقية مباشرة نبني فيها واجهة برمجية كاملة خطوة بخطوة مع إجابة أسئلتكم.',
      days: 3, hour: 20, duration: 90, capacity: 40, price: 7.9, category: 'البرمجة وتقنية المعلومات' },
    { instructor: instructor2, course: courseIds[1], title: 'جلسة استشارية: راجع خطة مشروعك',
      description: 'جلسة جماعية نراجع فيها خطط المشاركين ونقدّم ملاحظات عملية مباشرة.',
      days: 5, hour: 19, duration: 60, capacity: 15, price: 14.9, category: 'إدارة الأعمال' },
    { instructor: instructor3, course: courseIds[2], title: 'حصة محادثة إنجليزية مجانية',
      description: 'حصة تجريبية مفتوحة للتدرّب على المحادثة في مواقف يومية.',
      days: 1, hour: 18, duration: 45, capacity: 50, price: 0, category: 'اللغات' },
    { instructor: instructor1, course: null, title: 'أساسيات Git وGitHub للمبتدئين',
      description: 'حصة مستقلة تشرح إدارة النسخ والتعاون على المشاريع.',
      days: 7, hour: 21, duration: 75, capacity: 60, price: 4.9, category: 'البرمجة وتقنية المعلومات' },
  ];

  const sessionIds = [];
  for (const session of liveSessions) {
    if (q.get('SELECT id FROM live_sessions WHERE title = ?', session.title)) continue;
    const startsAt = new Date(addDays(session.days));
    startsAt.setUTCHours(session.hour - 4, 0, 0, 0);   // توقيت مسقط ‎+04:00
    const id = q.run(
      `INSERT INTO live_sessions (course_id, instructor_id, category_id, title, description, starts_at,
                                  duration_minutes, capacity, price, meeting_provider, room_code)
       VALUES (?,?,?,?,?,?,?,?,?, 'internal', ?)`,
      session.course, session.instructor, categoryIds[session.category], session.title, session.description,
      startsAt.toISOString(), session.duration, session.capacity, session.price, randomCode(7)).lastInsertRowid;
    sessionIds.push(id);

    // اختبار تفاعلي مباشر جاهز للحصة
    const liveQuizId = q.run(
      `INSERT INTO quizzes (live_session_id, instructor_id, title, mode, pass_score, attempts_allowed)
       VALUES (?,?,?, 'live', 60, 0)`,
      id, session.instructor, `مسابقة سريعة: ${session.title}`).lastInsertRowid;
    [
      ['ما أفضل وقت لطرح سؤالك في الحصة؟', ['في أي وقت عبر الدردشة', 'بعد انتهاء الحصة فقط', 'لا تسأل'], [0], 15],
      ['كم مدة هذه الحصة؟', [`${session.duration} دقيقة`, 'ساعتان', '١٠ دقائق'], [0], 20],
    ].forEach(([text, options, correct, seconds], i) => {
      q.run(
        `INSERT INTO quiz_questions (quiz_id, text, type, options, correct, points, time_seconds, position)
         VALUES (?,?, 'single', ?,?,1,?,?)`,
        liveQuizId, text, toJson(options), toJson(correct), seconds, i);
    });
  }

  /* ------------------------- ملخّصات الكتب ------------------------- */
  const summaries = [
    { author: instructor3, category: 'التطوير الذاتي',
      title: 'ملخّص: العادات الذرية', book: 'Atomic Habits', bookAuthor: 'جيمس كلير',
      price: 2.9, minutes: 18,
      description: 'كيف تبني عادات صغيرة تُحدث فرقاً هائلاً على المدى الطويل — مع خطة تطبيق عملية.',
      ideas: ['التحسّن ١٪ يومياً يضاعف نتائجك ٣٧ مرة سنوياً', 'العادة = إشارة ← رغبة ← استجابة ← مكافأة',
              'غيّر هويتك لا أهدافك فقط', 'اجعل العادة الجيدة واضحة وجذابة وسهلة ومُرضية', 'قاعدة الدقيقتين لبدء أي عادة'] },
    { author: instructor2, category: 'إدارة الأعمال',
      title: 'ملخّص: البدء بالأهم', book: 'Essentialism', bookAuthor: 'جريج ماكيون',
      price: 2.9, minutes: 15,
      description: 'فن التركيز على القليل المهم بدل الكثير التافه، وكيف تقول «لا» بذكاء.',
      ideas: ['أقل ولكن أفضل', 'إن لم يكن «نعم بوضوح» فهو «لا»', 'المقايضة حقيقة لا يمكن تجاهلها', 'احمِ وقتك كأصل ثمين'] },
    { author: instructor1, category: 'المال والاستثمار',
      title: 'ملخّص: سيكولوجية المال', book: 'The Psychology of Money', bookAuthor: 'مورغان هاوسل',
      price: 3.9, minutes: 22,
      description: 'لماذا يتصرّف الأذكياء بغباء مع المال؟ ١٩ درساً عن السلوك المالي أهم من المعادلات.',
      ideas: ['السلوك أهم من الذكاء في الاستثمار', 'الوقت هو أقوى رافعة للفائدة المركّبة',
              'الثروة هي ما لا تراه', 'اترك هامشاً للخطأ دائماً', 'الحرية أعظم عائد يشتريه المال'] },
    { author: instructor3, category: 'التطوير الذاتي',
      title: 'ملخّص: العمل العميق', book: 'Deep Work', bookAuthor: 'كال نيوبورت',
      price: 0, minutes: 12,
      description: 'ملخّص مجاني: كيف تنتج عملاً عالي القيمة في عالم مليء بالمشتّتات.',
      ideas: ['التركيز العميق مهارة نادرة وثمينة', 'الملل ليس عدواً بل تدريب', 'قلّل استهلاك المشتّتات'] },
  ];

  for (const summary of summaries) {
    if (q.get('SELECT id FROM summaries WHERE title = ?', summary.title)) continue;
    const body = summary.ideas.map((idea, i) => `## ${i + 1}. ${idea}\n\nشرح موسّع للفكرة مع مثال تطبيقي من الواقع، وكيف تنقلها إلى ممارسة يومية ابتداءً من اليوم.`).join('\n\n');
    q.run(
      `INSERT INTO summaries (author_id, category_id, title, slug, book_title, book_author, description, price,
                              reading_minutes, key_ideas, preview_content, content, status, published_at, featured)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'published', ?, 1)`,
      summary.author, categoryIds[summary.category], summary.title, slugify(summary.title), summary.book,
      summary.bookAuthor, summary.description, summary.price, summary.minutes, toJson(summary.ideas),
      `### مقتطف مجاني\n\n${summary.description}\n\n**أول فكرة:** ${summary.ideas[0]}\n\n_اشترِ الملخّص للاطلاع على بقية الأفكار وخطة التطبيق._`,
      `# ${summary.title}\n\n**الكتاب:** ${summary.book} — ${summary.bookAuthor}\n\n${summary.description}\n\n${body}\n\n## خطة التطبيق في ٧ أيام\n\nجدول عملي يترجم أفكار الكتاب إلى خطوات يومية صغيرة قابلة للقياس.`,
      nowIso());
  }

  /* ------------------------- كوبونات ------------------------- */
  const coupons = [
    ['WELCOME20', 'percent', 20, null, 0],
    ['RAMADAN50', 'percent', 50, 100, 5],
    ['BOOK1', 'fixed', 1, 200, 2],
  ];
  for (const [code, type, value, maxUses, minAmount] of coupons) {
    if (q.get('SELECT id FROM coupons WHERE code = ?', code)) continue;
    q.run('INSERT INTO coupons (code, type, value, max_uses, min_amount, applies_to, expires_at) VALUES (?,?,?,?,?,?,?)',
      code, type, value, maxUses, minAmount, toJson({ type: 'all' }), addDays(90));
  }

  /* ------------------------- إعدادات المنصّة ------------------------- */
  settings.set('hero_title', 'تعلّم بلا حدود');
  settings.set('hero_subtitle', 'حصص مباشرة مع معلّمين حقيقيين، دورات مسجّلة، وملخّصات كتب تقرأها في دقائق.');
  settings.set('support_whatsapp', '+968 0000 0000');
  settings.set('about', 'منصّة تعليمية عربية تجمع الحصص المباشرة والدورات المسجّلة وملخّصات الكتب في مكان واحد.');

  /* ------------------------- تسجيل الطالب التجريبي ------------------------- */
  if (courseIds.length) {
    q.run('INSERT INTO entitlements (user_id, item_type, item_id, source) VALUES (?,?,?, \'free\') ON CONFLICT DO NOTHING',
      student1, 'course', courseIds[2]);
    q.run('INSERT INTO enrollments (user_id, course_id, progress_percent) VALUES (?,?,?) ON CONFLICT DO NOTHING',
      student1, courseIds[2], 0);
    q.run('UPDATE courses SET students_count = (SELECT COUNT(*) FROM enrollments WHERE course_id = ?) WHERE id = ?',
      courseIds[2], courseIds[2]);
  }
})();

console.log(`
✅ اكتملت التعبئة

   الحسابات التجريبية (كلمة المرور: ${PASSWORD})
   ─────────────────────────────────────────────
   مدير    : admin@manassah.om
   معلّم   : abdulrahman@manassah.om
   معلّم   : salem@manassah.om
   معلّمة  : maryam@manassah.om
   طالب    : student@manassah.om   (رصيد ٥٠)

   شغّل المنصّة:  npm start
`);
