# منصّة تعليم عُمانية — وثيقة التخطيط

> هذه الوثيقة هي المرجع الواحد للمشروع: التقييم الحالي، المعمارية، نموذج البيانات، خريطة الشاشات، نظام التصميم، مراحل التنفيذ، والمخاطر. كل قرار تقني في الشيفرة يعود إليها.

---

## 1. CURRENT STATE AUDIT — تقييم الوضع الحالي

### ما كان موجوداً

| العنصر | الحالة | القرار |
|---|---|---|
| `legacy/family-quiz.html` | اختبار عائلي تفاعلي (صفحة واحدة، Socket.IO بلا خادم) | محفوظ كما هو |
| `legacy/v1/` — الإصدار الأول | خادم Node/Express/SQLite + واجهة ويب SPA بـ JavaScript خالص + ٢٢ اختبار تكامل | **محفوظ ويعمل**، ويُستخرَج منه ما ثبتت صلاحيته |

### ما يُعاد استخدامه من الإصدار الأول (ثبتت صلاحيته بالاختبار)

1. **طبقة تجريد الدفع** (`services/payments.js`) — مزوّدون قابلون للتبديل (mock / wallet / manual / Stripe) خلف واجهة واحدة، مع تحقّق توقيع الـ webhook ورفض الطوابع الزمنية القديمة.
2. **محرّك الطلبات** (`services/checkout.js`) — إنشاء طلب → تنفيذ آمن للتكرار (idempotent) في معاملة واحدة: منح الصلاحيات، قيد حصّة المعلّم بعد العمولة، الكوبون، الإحالة. والاسترجاع الكامل بعكس كل ذلك.
3. **نموذج الصلاحيات** (`services/access.js`) — جدول `entitlements` موحّد يفصل «من يملك ماذا» عن نوع المنتج، والحجب على مستوى الاستعلام لا الواجهة.
4. **دفتر المحفظة** (`services/wallet.js`) — قيود بأرصدة لاحقة، لا تعديل مباشر للرصيد.
5. **قاعة البثّ** (`realtime/live.js`) — مصادقة قبل الانضمام، حضور بالدقائق، رفع يد، سؤال سريع بنقاط سرعة والإجابات الصحيحة لا تغادر الخادم.
6. **أنماط الأمان** — رموز تجديد مُجزّأة ومُدوَّرة، رسائل موحّدة عند فشل الدخول، تحقّق Zod على كل مدخل، تطهير أسماء الملفات.

### مشاكل الإصدار الأول التي تمنع البناء عليه مباشرة

| المشكلة | الأثر |
|---|---|
| **نموذج بيانات «سوق دورات»** (courses / summaries / live_sessions) | لا يعبّر عن مدرسة: لا صفوف ولا مواد ولا وحدات ولا فصول دراسية. المحتوى غير مرتبط بصفّ الطالب |
| **الحصص المباشرة «فعاليات» لا «حجوزات»** | لا تقويم للمعلّم، لا مواعيد متاحة، لا منع للتعارض، لا باقات حصص |
| **لا اعتماد للمعلّمين بمستندات** | علامة `approved` واحدة بلا مستندات ولا مراجعة ولا حالات |
| **الحماية للملفات ناقصة** | الملفات تُخدَم من مجلد عام؛ لا روابط موقّعة ولا علامة مائية |
| **مصادقة بكلمة مرور فقط** | لا OTP ولا Apple/Google — والجمهور طلاب بأرقام هواتف |
| **أدوار ثلاثة فقط** (student / instructor / admin) | لا وليّ أمر، لا مراجع محتوى، لا دعم، لا مالية |
| **واجهة ويب لا جوال** | المطلوب Android + iOS أولاً |
| **JavaScript بلا أنواع** | في الحجز والمال تحديداً، غياب الأنواع مكلف |
| **سياسة الإلغاء غير موجودة** | لا استرجاع جزئي مرتبط بالوقت |

**الخلاصة:** يُحتفَظ بالمنطق المُثبَت ويُنقَل إلى TypeScript فوق نموذج بيانات جديد؛ ولا تُهدَم النسخة الأولى بل تبقى مرجعاً قابلاً للتشغيل.

---

## 2. PROPOSED ARCHITECTURE — المعمارية المقترحة

### القرار التقني

| الطبقة | الاختيار | لماذا |
|---|---|---|
| **الجوال** | **Expo SDK 57 + React Native + TypeScript + Expo Router** | Android وiOS من شيفرة واحدة، والويب من الشيفرة نفسها عبر react-native-web (يحقّق «قابل للتوسّع للويب» بلا إعادة كتابة). Expo Router يعطي تنقّلاً بالملفات وروابط عميقة |
| **الخادم** | **Node 22 + Express + TypeScript** (يعمل عبر `tsx`، بلا خطوة بناء) | يُنقَل المنطق المُثبَت من v1 مباشرة. Express 4 تحديداً لأن الشيفرة المنقولة مكتوبة على دلالاته |
| **قاعدة البيانات** | **SQLite (better-sqlite3)** في المرحلة الأولى، بمخطّط SQL عادي قابل للنقل إلى **PostgreSQL** | البدء بلا خادم قاعدة بيانات يسرّع التطوير؛ والمخطّط مكتوب بلا خصائص SQLite-فقط حتى يكون الانتقال إلى Postgres تغييراً في طبقة الاتصال لا في المنطق |
| **الوقت الحقيقي** | Socket.IO | حضور القاعة، الدردشة، الإشعارات الفورية |
| **الفيديو** | **مزوّد خارجي خلف واجهة** (`RoomProvider`): LiveKit / Daily / Agora | بناء WebRTC ذاتياً غير مبرَّر. الواجهة تُعطي رمز غرفة محدود المدة من الخادم؛ التطبيق لا يعرف مفاتيح المزوّد |
| **الدفع** | واجهة `PaymentProvider` (منقولة من v1) — Thawani للسوق العُماني، وStripe للتوسّع | تبديل المزوّد حسب البلد وسياسات المتاجر دون لمس الواجهة |
| **الإدارة** | **Vite + React + TypeScript** (ويب) | لوحة إدارة أدواتها مكتبية لا جوّالة |
| **المشترك** | `packages/shared` (عقود Zod → أنواع TS، مفاتيح الترجمة، إعداد العلامة) و`packages/tokens` (رموز التصميم) | عقد واحد بين الخادم والعميلين |

### هيكل المستودع

```
/
├── apps/
│   ├── mobile/        Expo — الطالب والمعلّم ووليّ الأمر
│   │   ├── app/       شاشات Expo Router (مسارات بالملفات)
│   │   └── src/
│   │       ├── ui/        نظام التصميم (المكوّنات)
│   │       ├── features/  منطق كل مجال (hooks + api)
│   │       ├── state/     zustand: auth · cart · room · ui
│   │       ├── api/       عميل HTTP مُنمَّط + react-query
│   │       └── i18n/      ar (أساسي) · en
│   ├── api/           Express + TS
│   │   └── src/
│   │       ├── domains/   auth · users · catalog · books · courses · quizzes
│   │       │              teachers · bookings · rooms · orders · payments
│   │       │              reviews · messages · notifications · admin
│   │       ├── services/  payments · checkout · access · wallet · rooms · storage
│   │       ├── db/        schema.sql · migrate · seed (تطوير فقط)
│   │       └── realtime/
│   └── admin/         Vite + React
├── packages/
│   ├── shared/        عقود Zod، أنواع، مفاتيح i18n، brand.ts
│   └── tokens/        ألوان · خطوط · مسافات · زوايا · حركة
├── legacy/
│   ├── v1/            الإصدار الأول كاملاً (مرجع قابل للتشغيل)
│   └── family-quiz.html
└── docs/
```

### مبادئ ملزمة

1. **العقد أولاً:** كل استجابة API لها مخطّط Zod في `packages/shared`. الخادم يتحقّق به والعميل يستنتج أنواعه منه.
2. **الصلاحية في الخادم فقط:** إخفاء زرّ ليس حماية. كل endpoint يمرّ بـ `requireRole` ويتحقّق من ملكية المورد.
3. **المال في الخادم فقط:** الأسعار والعمولات والأرصدة تُحسَب في الخادم؛ العميل يعرض ما يُرسَل إليه.
4. **الحالة مفصولة في العميل:** server state (react-query) · auth · cart · room · ui — لا مخزن عالمي واحد.
5. **السياسات إعدادات لا شيفرة:** الإلغاء، العمولة، الضريبة، الحد الأدنى للسحب — في جدول `settings` تُدار من لوحة الإدارة.
6. **الإعداد المركزي للعلامة:** `packages/shared/src/brand.ts` — الاسم والشعار والألوان الرئيسية في مكان واحد.
7. **المحتوى المدفوع لا يغادر الخادم:** الملفات في مجلد خاص، تُقدَّم عبر روابط موقّعة قصيرة العمر مرتبطة بالمستخدم، مع علامة مائية اختيارية.

### تدفّقات حرجة

**الحجز (منع التعارض):**
```
اختيار موعد → الخادم يتحقّق داخل معاملة واحدة:
  ١. الموعد داخل availability المعلّم
  ٢. ليس في time_off
  ٣. لا يتقاطع مع booking فعّال (قيد فريد على teacher_id + starts_at + status)
→ إنشاء الحجز بحالة pending_payment بصلاحية ١٠ دقائق
→ الدفع → confirmed → إنشاء live_room برمز
```

**الغرفة المباشرة:**
```
قبل الموعد بـ ١٥ دقيقة: يُسمَح بطلب رمز الغرفة
→ الخادم يتحقّق: حجز مؤكَّد + طالب مصادَق + معلّم معتمد
→ يُصدر room token محدود المدة من مزوّد الفيديو
→ يسجّل joined_at / left_at / reconnects لكل طرف
→ الحضور يُستخدَم في النزاعات والاسترجاع وأرباح المعلّم
```

---

## 3. DATA MODEL — نموذج البيانات

> علاقات SQL صريحة. لا JSON إلا في حقول الإعدادات والبيانات الوصفية المتغيّرة الشكل.

### الهوية والأدوار
| الجدول | الحقول الأساسية |
|---|---|
| `users` | id, phone, email, status, locale, timezone(`Asia/Muscat`), created_at |
| `user_roles` | user_id, role ∈ {student, parent, teacher, content_reviewer, support, finance, admin, super_admin} |
| `auth_identities` | user_id, provider ∈ {phone_otp, email_otp, apple, google}, provider_uid |
| `otp_codes` | user_id/target, code_hash, expires_at, attempts |
| `refresh_tokens` | user_id, token_hash, expires_at, revoked |
| `profiles` | user_id, display_name, avatar, gender?, bio |
| `student_profiles` | user_id, curriculum_id, grade_id, semester_id, school? |
| `student_subjects` | user_id, subject_id |
| `teacher_profiles` | user_id, headline, bio, years_exp, verification_status ∈ {pending, under_review, verified, rejected, suspended}, commission_rate, rating_avg, rating_count, students_count, lessons_count |
| `teacher_subjects` | teacher_id, subject_id, grade_id |
| `teacher_documents` | teacher_id, type ∈ {id, degree, certificate, photo}, file_path, status |
| `teacher_verifications` | teacher_id, reviewer_id, decision, reason, decided_at |
| `parent_links` | parent_id, student_id, status |

### المنهج (هرمي — لا شيء مثبَّت في الشيفرة)
```
countries → curriculums → grades → semesters
                        ↘ subjects (لكل منهج) → units (لكل مادة+صف+فصل) → lessons
```
| الجدول | الحقول |
|---|---|
| `countries` | id, code, name |
| `curriculums` | id, country_id, name (مثال: وزارة التربية والتعليم) |
| `grades` | id, curriculum_id, name, order |
| `semesters` | id, curriculum_id, name, order |
| `subjects` | id, curriculum_id, name, slug, color_key |
| `units` | id, subject_id, grade_id, semester_id, title, order |
| `lessons` | id, unit_id, title, order |

### الكتب
| الجدول | الحقول |
|---|---|
| `books` | id, author_id, title, type ∈ {summary, exercises, solved_problems, final_review, question_bank, english_book, grammar, vocabulary, foundation, exam_models}, subject_id, grade_id, semester_id, price, currency, pages, edition, version, language, level, cover_path, status ∈ {draft, pending_review, approved, rejected, published, archived}, rating_avg, sales_count |
| `book_files` | book_id, kind ∈ {full, preview}, storage_path (خاص), size, checksum |
| `book_previews` | book_id, page_from, page_to |
| `book_toc` | book_id, title, page, order |
| `book_purchases` | user_id, book_id, order_id → (يُنشئ entitlement) |
| `content_reviews` | entity_type, entity_id, reviewer_id, decision, reason |

### الدورات والاختبارات
| الجدول | الحقول |
|---|---|
| `courses` | id, teacher_id, title, subject_id, grade_id, price, trailer_path, status, rating_avg |
| `course_sections` | course_id, title, order |
| `course_lessons` | section_id, title, video_path (خاص), duration_s, is_preview, order |
| `course_enrollments` | user_id, course_id, order_id, progress_percent |
| `lesson_progress` | user_id, lesson_id, seconds, completed |
| `quizzes` | id, owner_type ∈ {book, course, lesson}, owner_id, pass_score, time_limit |
| `quiz_questions` | quiz_id, type ∈ {mcq, true_false, short}, text, options, answer, explanation, topic_tag, points |
| `quiz_attempts` | user_id, quiz_id, score, percent, answers, topic_breakdown, duration_s |

### المعلّمون والحجز
| الجدول | الحقول |
|---|---|
| `teacher_availability` | teacher_id, weekday, start_time, end_time, slot_minutes, break_minutes |
| `teacher_time_off` | teacher_id, starts_at, ends_at, reason |
| `lesson_packages` | teacher_id, lessons_count, duration_minutes, price, mode ∈ {individual, group} |
| `package_purchases` | user_id, package_id, order_id, remaining |
| `bookings` | id, student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status ∈ {pending_payment, confirmed, in_progress, completed, cancelled_by_student, cancelled_by_teacher, no_show, disputed}, price, order_id, package_purchase_id, expires_at — **قيد فريد جزئي على (teacher_id, starts_at) للحالات الفعّالة** |
| `booking_attendance` | booking_id, user_id, role, joined_at, left_at, reconnects, seconds |
| `booking_notes` | booking_id, teacher_id, summary, homework, attachments |
| `live_rooms` | booking_id, provider, provider_room_id, opens_at, closes_at, status |
| `room_participants` | room_id, user_id, token_issued_at, token_expires_at |

### التجارة
| الجدول | الحقول |
|---|---|
| `carts` / `cart_items` | user_id · item_type ∈ {book, course}, item_id |
| `orders` | id, number, user_id, subtotal, discount, tax, total, currency, coupon_id, status |
| `order_items` | order_id, item_type, item_id, unit_price, teacher_id, teacher_share, platform_share |
| `payments` | order_id, provider, provider_ref, amount, status, raw |
| `refunds` | order_id, booking_id?, amount, reason, policy_applied, status |
| `entitlements` | user_id, item_type, item_id, source, expires_at — **الحقيقة الوحيدة لمن يملك ماذا** |
| `wallet_transactions` | user_id, type, amount, balance_after |
| `teacher_earnings` | teacher_id, source_type, source_id, gross, commission, net, status ∈ {pending, available, paid} |
| `teacher_payouts` | teacher_id, amount, method, status |
| `coupons` | code, type, value, starts_at, ends_at, usage_limit, user_limit, scope (products / teacher / category) |
| `subscriptions` / `plans` | للمرحلة الثانية — الجداول موجودة، الواجهة لاحقاً |
| `invoices` | order_id, number, pdf_path |

### التفاعل
| الجدول | الحقول |
|---|---|
| `reviews` | user_id, target_type ∈ {teacher, book, course}, target_id, rating, comment, **gate_ref** (booking_id / order_id يثبت التجربة) |
| `favorites` | user_id, target_type, target_id |
| `conversations` / `messages` | بين طالب ومعلّم، مرتبطة بحجز أو منتج؛ نص/صورة/ملف |
| `reports` | reporter_id, target_type, target_id, reason, status |
| `blocks` | user_id, blocked_user_id |
| `notifications` | user_id, type, title, body, data, read_at |
| `device_tokens` | user_id, platform, token |

### النظام
| الجدول | الحقول |
|---|---|
| `settings` | key, value — سياسة الإلغاء، العمولة، الضريبة، حدّ السحب، ساعات فتح الغرفة |
| `audit_logs` | actor_id, action, entity, entity_id, meta, ip |
| `admin_actions` | admin_id, action, target, reason |
| `analytics_events` | user_id?, name, props, at (الحد الأدنى) |

---

## 4. SCREEN MAP — خريطة الشاشات

### التنقّل السفلي (٥ فقط)
`الرئيسية` · `المكتبة` · `الحصص` · `الدورات` · `حسابي` — والبحث في أعلى كل تبويب.

### الدخول
Splash → Onboarding (٣ خطوات) → اختيار الدور → OTP (هاتف / بريد) → إعداد الطالب (الصف → المواد) → الرئيسية
المعلّم: → تسجيل المعلّم → رفع المستندات → «طلبك قيد المراجعة»

### الرئيسية (الترتيب ملزم)
1. ترويسة: الصورة · «صباح الخير، سالم» · الصف · إشعارات · بحث
2. **حصّتك القادمة** (بطاقة كبيرة: المادة، المعلّم، الوقت، العدّ التنازلي، «دخول الحصة») — أو «ما عندك حصة قادمة → احجز معلّماً»
3. **احجز معلّماً** + إجراءات سريعة: اشترِ ملخّصاً · حلّ مسائل · الدورات · اختبار سريع
4. **أكمل من حيث توقّفت** (كتاب / دورة / اختبار)
5. **ملخّصات صفّك** (مفلترة بصفّ الطالب)
6. **الدورات**
7. **معلّمون موصى بهم**
8. حلّ مسائل خطوة بخطوة · عروض (إن وُجدت)

### المكتبة
Library (بحث + فلاتر: الصف · المادة · الفصل · النوع · السعر · التقييم · الترتيب) → Book details → Preview → Reader
Cart → Checkout → Purchase success · My Library (كتبي · ملخّصاتي · دوراتي · المحفوظات)

### المعلّمون والحجز
Teacher search (فلاتر) → Teacher profile (المستندات المعتمدة، المواد، الأسعار ٣٠/٤٥/٦٠، التقييمات، الجدول) → Booking: نوع الحصة → التاريخ → الوقت → مراجعة → دفع → تمّ (٥ خطوات في ٣ شاشات) · Packages

### الحصص
Tabs: القادمة (اليوم · غداً · هذا الأسبوع) · السابقة · باقاتي
Lesson details → Pre-call (كاميرا · ميكروفون · اتصال) → Live room → Post-lesson (تقييم · ملخّص · واجب · مرفقات)

### الدورات
Courses → Course details (Trailer · المنهج · المتطلّبات) → Player (سرعات، ١٠ث، تقدّم) → Lesson → Quiz → Result → «راجع نقاط ضعفك»

### الحساب
Profile · Purchases (كتب · دورات · حصص · اشتراكات) · Favorites · Progress dashboard · Notifications · Messages → Conversation · Settings · Language · Support · Terms · Privacy

### المعلّم
Dashboard (دخل الشهر، حصص اليوم، الطلاب، الرصيد) · Calendar (availability, time-off) · Lessons · Students · Products · Upload book · Create course · Earnings (gross / commission / net / pending / available / paid)

### لوحة الإدارة (ويب)
Overview · Users · Teachers · **Teacher verification** · Books · Courses · **Content review** · Bookings · Payments · Refunds · Payouts · Reviews · Coupons · Reports · Support · **Curriculum** (Country → Curriculum → Grade → Semester → Subject → Unit → Lesson) · Settings (السياسات) · Audit logs

### حالات كل شاشة (شرط القبول)
Loading (Skeleton) · Empty (رسالة + إجراء) · Error (رسالة عربية + إعادة محاولة) · Offline · Success

---

## 5. DESIGN SYSTEM — نظام التصميم

### الرموز (packages/tokens)

**اللون** — كما حُدِّد، مع إضافة درجات مشتقّة للحالات:
| الرمز | القيمة | الاستخدام |
|---|---|---|
| `bg.base` | `#F8F6F1` | خلفية الشاشة |
| `bg.subtle` | `#F1EEE7` | خلفيات ثانوية، Skeleton |
| `bg.card` | `#FFFFFF` | البطاقات |
| `brand.primary` | `#9E1B32` | **الأفعال الرئيسية فقط** (شراء، حجز، دخول) |
| `brand.primaryDark` | `#751426` | ضغط الزرّ، عناوين على خلفية فاتحة |
| `brand.gold` | `#C7A461` | شارة «معتمد»، التقييم، لمسة الهوية |
| `text.primary` | `#171717` | |
| `text.secondary` | `#686868` | |
| `state.success` | `#287A59` | |
| `state.info` | `#315D7A` | الحصص والشرح |
| `state.warning` | `#A8730F` | مشتق |
| `state.danger` | `#B3261E` | مشتق — أخطاء فقط، متمايز عن الأحمر العُماني |
| `border` | `#E6E1D6` | مشتق من الخلفية |

القاعدة: **الأحمر للفعل الرئيسي الواحد في الشاشة.** الأزرق للحصص. الذهبي للثقة. الباقي محايد.

**الخط** — `IBM Plex Sans Arabic` (أساسي) مع سلّم:
| الدور | الحجم / الوزن |
|---|---|
| Display | 30 / 700 |
| H1 | 24 / 700 |
| H2 | 20 / 600 |
| H3 | 17 / 600 |
| Body | 15 / 400 |
| Small | 13 / 400 |
| Caption | 12 / 500 |
| Button | 15 / 600 |
| Price | 18 / 700 — أرقام جدولية |
| Numbers | tabular-nums دائماً |

**المسافات:** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40
**الزوايا:** 8 (chips) · 12 (inputs, buttons) · 16 (cards) · 20 (sheets)
**الحركة:** 150ms (feedback) · 200ms (transitions) · 250ms (sheets) — بلا bounce
**الهوية العُمانية:** نمط هندسي خافت جداً (opacity ≤ 6٪) في الترويسة والـ Splash فقط؛ حافة ذهبية رفيعة على بطاقة الحصة القادمة وشارة «معتمد». لا خناجر ولا قلاع.

### المكوّنات (apps/mobile/src/ui)
`Button` (primary · secondary · ghost · sizes) · `Input` · `SearchInput` · `Card` · `BookCard` · `TeacherCard` · `CourseCard` · `LessonCard` · `Chip` · `Badge` · `Avatar` · `Rating` · `Price` · `EmptyState` · `ErrorState` · `Skeleton` · `Tabs` · `SectionHeader` · `Calendar` · `TimeSlot` · `BottomSheet` · `Modal` · `Text` (بأدوار السلّم) · `Screen` (حاوية بحالات loading/error/empty)

### i18n
كل نصّ عبر مفتاح: `home.greeting`, `home.nextLesson.join`, `library.filters.grade`… العربية أساس وRTL أصلي؛ الإنجليزية LTR.

---

## 6. IMPLEMENTATION PHASES — مراحل التنفيذ

### المرحلة ٠ — الأساس (هذه الجلسة)
- [x] وثيقة التخطيط
- [ ] monorepo: apps/mobile · apps/api · apps/admin · packages/shared · packages/tokens
- [ ] `packages/tokens` + `packages/shared` (brand.ts، عقود Zod الأساسية، مفاتيح i18n)
- [ ] مخطّط قاعدة البيانات الكامل + هجرة + seed تطويري (معلَّم بوضوح)
- [ ] نظام التصميم: المكوّنات المذكورة
- [ ] الشاشات العشر الأساسية: Home · Library · Book detail · Teacher search · Teacher profile · Lessons · Courses · Live room (pre-call + room) · Profile · Onboarding/OTP
- [ ] الخادم: auth (OTP + أدوار) · catalog · books (روابط موقّعة) · teachers (اعتماد + توفّر) · bookings (منع تعارض + سياسة إلغاء من الإعدادات) · orders/payments/entitlements · rooms (رموز) · reviews (مقيَّدة بالتجربة) · notifications
- [ ] اختبارات المسارات الحسّاسة
- [ ] لوحة إدارة: اعتماد المعلّمين · مراجعة المحتوى · الحجوزات · السحوبات · الإعدادات · المنهج

### المرحلة ١ — MVP قابل للإطلاق
- Reader داخلي (صفحة/تمرير، zoom، علامات، آخر صفحة، فهرس، ملاحظات)
- Course player كامل (سرعات، تقدّم، إكمال)
- مزوّد فيديو حقيقي خلف `RoomProvider` (LiveKit) + سبّورة ومشاركة ملف
- Thawani للدفع العُماني + Apple/Google Sign-in
- Push notifications (Expo Notifications)
- الرسائل طالب↔معلّم مع Report/Block
- Global search مع تطبيع عربي
- Offline: الكتب المسموح تنزيلها + معلومات الحصص
- Analytics events (الحد الأدنى)

### المرحلة ٢
حساب وليّ الأمر · اختبارات متقدّمة (matching) · واجبات · شهادات · اشتراكات · حصص جماعية · حملات خصم · متابعة المعلّمين · streaks · مساعد تعليمي AI بضوابط · تصوير المسألة · تنزيل الدورات · شراكات المدارس

---

## 7. RISKS & GAPS — المخاطر والنواقص

| # | الخطر | الأثر | التخفيف |
|---|---|---|---|
| 1 | **الفيديو المباشر** — بناء WebRTC ذاتياً غير واقعي | جودة رديئة، انقطاعات، تكلفة صيانة | مزوّد خارجي خلف واجهة؛ الخادم يُصدر الرموز فقط. المرحلة ٠ تبني الغرفة كاملة (حضور، دردشة، يد، سؤال) والفيديو placeholder موثّق |
| 2 | **الدفع في عُمان** — Stripe لا يعمل مباشرة للتجّار العُمانيين | لا يمكن قبض المال | واجهة مزوّد؛ Thawani أو Amwal في المرحلة ١. سياسات المتاجر (Apple IAP) للمحتوى الرقمي تحتاج قراراً قانونياً |
| 3 | **الاعتماد والقاصرون** | مسؤولية قانونية | لا غرفة بلا حجز رسمي ومعلّم معتمد؛ لا كشف بيانات الطالب؛ Report/Block؛ سجلّ تدقيق. **يلزم مراجعة قانونية لسياسة الخصوصية وحماية الأطفال قبل الإطلاق** |
| 4 | **حماية الملفات** | تسريب الكتب | روابط موقّعة قصيرة العمر + علامة مائية باسم المستخدم. لا يمكن منع تصوير الشاشة ١٠٠٪ — ويُصرَّح بذلك |
| 5 | **التعارض في الحجز** | حصتان في وقت واحد | قيد فريد في قاعدة البيانات + معاملة + انتهاء صلاحية الحجز غير المدفوع |
| 6 | **SQLite في الإنتاج** | لا يتوسّع لعشرات الآلاف المتزامنين | مخطّط قابل للنقل؛ الانتقال إلى PostgreSQL قبل الإطلاق العام |
| 7 | **الأصول البصرية** | الاعتماد على صور مؤقتة | اتجاه فني موثّق؛ يلزم تصوير حقيقي أو رسوم مخصّصة |
| 8 | **حقوق المناهج** | ملخّصات لمناهج الوزارة قد تحمل قيوداً | مراجعة المحتوى الإدارية تشمل بند حقوق النشر؛ يلزم رأي قانوني |
| 9 | **الاختبار على أجهزة حقيقية** | البيئة الحالية تختبر عبر الويب فقط | RTL والتخطيط يُتحقَّق منهما على react-native-web؛ الاختبار على iOS/Android الفعلية خطوة لاحقة إلزامية |
| 10 | **الأسماء والأرقام الوهمية** | فقدان الثقة | seed تطويري منفصل ومُعلَّم؛ الإنتاج يبدأ فارغاً وكل رقم من بيانات فعلية |

**نواقص مُعلَنة في هذه الجلسة:** لا فيديو حقيقي، لا مزوّد دفع عُماني مفعّل، لا Apple/Google sign-in، لا push، Reader وPlayer بنسخ أساسية. كلها في المرحلة ١ ومعماريتها جاهزة.
