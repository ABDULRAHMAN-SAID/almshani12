-- ============================================================
--  منصّة تعليم عُمانية — مخطّط قاعدة البيانات (SQLite → قابل للنقل إلى PostgreSQL)
--  علاقات صريحة؛ JSON فقط في الإعدادات والبيانات الوصفية المتغيّرة الشكل.
-- ============================================================
PRAGMA foreign_keys = ON;

-- ------------------------- الهوية والأدوار -------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT UNIQUE,
  email         TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  locale        TEXT NOT NULL DEFAULT 'ar',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Muscat',
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  -- المتعلّم النشط (يضبطه العميل عبر /me/learners/:id/activate) وسبب الإيقاف — أُضيفت بالترحيل 002 على القواعد القديمة
  active_learner_id INTEGER REFERENCES learners(id) ON DELETE SET NULL,
  status_reason TEXT,
  suspended_at  TEXT,
  suspended_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL CHECK (role IN ('student','parent','teacher','content_reviewer','support','finance','admin','super_admin')),
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS auth_identities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('phone_otp','email_otp','apple','google')),
  provider_uid TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel    TEXT NOT NULL CHECK (channel IN ('phone','email')),
  target     TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  provider   TEXT NOT NULL DEFAULT 'local',   -- local (الرمز محلي مهشّر) | twilio_verify (الرمز عند Twilio)
  via        TEXT                             -- sms | whatsapp | email | test
);
CREATE INDEX IF NOT EXISTS idx_otp_target ON otp_codes(target, channel);
CREATE INDEX IF NOT EXISTS idx_otp_created ON otp_codes(created_at);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device     TEXT,
  ip         TEXT,
  expires_at INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_path  TEXT,
  gender       TEXT CHECK (gender IN ('male','female')),
  bio          TEXT,
  country_code TEXT NOT NULL DEFAULT 'OM',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  curriculum_id INTEGER REFERENCES curriculums(id) ON DELETE SET NULL,
  grade_id      INTEGER REFERENCES grades(id) ON DELETE SET NULL,
  semester_id   INTEGER REFERENCES semesters(id) ON DELETE SET NULL,
  school        TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_subjects (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, subject_id)
);

-- ---------- المتعلّمون: ملفّات تعلّم مملوكة للحساب (طالب بصفّين أو وليّ أمر بعدّة أبناء) ----------
-- student_profiles / student_subjects أعلاه تُكتب انعكاساً للمتعلّم الذاتي الأول فقط (services/learners.ts) وتُحذف في الإصدار التالي
CREATE TABLE IF NOT EXISTS learners (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  gender        TEXT CHECK (gender IN ('male','female')),
  avatar_path   TEXT,
  is_self       INTEGER NOT NULL DEFAULT 0,
  curriculum_id INTEGER REFERENCES curriculums(id) ON DELETE SET NULL,
  grade_id      INTEGER REFERENCES grades(id) ON DELETE SET NULL,
  semester_id   INTEGER REFERENCES semesters(id) ON DELETE SET NULL,
  school        TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  archived_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_learners_account ON learners(account_id, archived_at, position);

CREATE TABLE IF NOT EXISTS learner_subjects (
  learner_id INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (learner_id, subject_id)
);

CREATE TABLE IF NOT EXISTS teacher_profiles (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline            TEXT,
  bio                 TEXT,
  qualification       TEXT,
  specialty           TEXT,
  years_exp           INTEGER NOT NULL DEFAULT 0,
  languages           TEXT NOT NULL DEFAULT '["ar"]',   -- JSON
  teaching_style      TEXT NOT NULL DEFAULT '[]',       -- JSON
  verification_status TEXT NOT NULL DEFAULT 'pending'
                      CHECK (verification_status IN ('pending','under_review','verified','rejected','suspended')),
  commission_rate     REAL NOT NULL DEFAULT 0.20,
  rating_avg          REAL NOT NULL DEFAULT 0,
  rating_count        INTEGER NOT NULL DEFAULT 0,
  students_count      INTEGER NOT NULL DEFAULT 0,
  lessons_count       INTEGER NOT NULL DEFAULT 0,
  available_balance   REAL NOT NULL DEFAULT 0,
  pending_balance     REAL NOT NULL DEFAULT 0,
  lifetime_earnings   REAL NOT NULL DEFAULT 0,
  payout_method       TEXT,
  payout_details      TEXT,
  applied_at          TEXT,
  verified_at         TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teacher_subjects (
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  grade_id   INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, subject_id, grade_id)
);

CREATE TABLE IF NOT EXISTS teacher_documents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('id','degree','certificate','photo','other')),
  file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','rejected')),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS teacher_verifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('under_review','verified','rejected','suspended')),
  reason      TEXT,
  decided_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parent_links (
  parent_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (parent_id, student_id)
);

-- ------------------------- الملفات (خاصة — لا تُخدَم مباشرة) -------------------------
CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,          -- مسار داخل المخزن الخاص
  original_name TEXT,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  checksum     TEXT,
  visibility   TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  purpose      TEXT NOT NULL DEFAULT 'general',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------- المنهج (هرمي) -------------------------
CREATE TABLE IF NOT EXISTS countries (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculums (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS grades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL REFERENCES curriculums(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  "order"       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS semesters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL REFERENCES curriculums(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  "order"       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subjects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL REFERENCES curriculums(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  color_key     TEXT NOT NULL DEFAULT 'default',
  "order"       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (curriculum_id, slug)
);
CREATE TABLE IF NOT EXISTS units (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  grade_id    INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  "order"     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_units_scope ON units(subject_id, grade_id, semester_id);
CREATE TABLE IF NOT EXISTS curriculum_lessons (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  title   TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0
);

-- ------------------------- الكتب -------------------------
CREATE TABLE IF NOT EXISTS books (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('summary','exercises','solved_problems','final_review','question_bank','english_book','grammar','vocabulary','foundation','exam_models')),
  subject_id    INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  grade_id      INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  semester_id   INTEGER REFERENCES semesters(id) ON DELETE SET NULL,
  description   TEXT NOT NULL DEFAULT '',
  learn_points  TEXT NOT NULL DEFAULT '[]',   -- JSON
  tags          TEXT NOT NULL DEFAULT '[]',   -- JSON
  price         REAL NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'OMR',
  pages         INTEGER,
  edition       TEXT,
  version       TEXT,
  language      TEXT NOT NULL DEFAULT 'ar',
  level         TEXT,
  preview_pages INTEGER NOT NULL DEFAULT 5,
  cover_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','rejected','published','archived')),
  reject_reason TEXT,
  rating_avg    REAL NOT NULL DEFAULT 0,
  rating_count  INTEGER NOT NULL DEFAULT 0,
  sales_count   INTEGER NOT NULL DEFAULT 0,
  featured      INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_books_scope ON books(status, grade_id, subject_id);

CREATE TABLE IF NOT EXISTS book_files (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('full','preview','sample_page')),
  file_id  INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  "order"  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS book_toc (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title   TEXT NOT NULL,
  page    INTEGER,
  "order" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  last_page  INTEGER NOT NULL DEFAULT 1,
  bookmarks  TEXT NOT NULL DEFAULT '[]',  -- JSON array of pages
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id)
);

-- ------------------------- الدورات -------------------------
CREATE TABLE IF NOT EXISTS courses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  subject_id    INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  grade_id      INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  description   TEXT NOT NULL DEFAULT '',
  learn_points  TEXT NOT NULL DEFAULT '[]',
  requirements  TEXT NOT NULL DEFAULT '[]',
  price         REAL NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'OMR',
  cover_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  trailer_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','rejected','published','archived')),
  reject_reason TEXT,
  rating_avg    REAL NOT NULL DEFAULT 0,
  rating_count  INTEGER NOT NULL DEFAULT 0,
  sales_count   INTEGER NOT NULL DEFAULT 0,
  featured      INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS course_sections (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  "order"   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS course_lessons (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id       INTEGER NOT NULL REFERENCES course_sections(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video','quiz','reading')),
  video_file_id    INTEGER REFERENCES files(id) ON DELETE SET NULL,
  reading_body     TEXT,
  quiz_id          INTEGER REFERENCES quizzes(id) ON DELETE SET NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  is_preview       INTEGER NOT NULL DEFAULT 0,
  "order"          INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS course_enrollments (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  order_id         INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  progress_percent REAL NOT NULL DEFAULT 0,
  last_lesson_id   INTEGER REFERENCES course_lessons(id) ON DELETE SET NULL,
  completed_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, course_id)
);
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id        INTEGER NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  position_seconds INTEGER NOT NULL DEFAULT 0,
  completed        INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, lesson_id)
);

-- ------------------------- الاختبارات -------------------------
CREATE TABLE IF NOT EXISTS quizzes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type         TEXT NOT NULL CHECK (owner_type IN ('book','course','course_lesson','unit','standalone')),
  owner_id           INTEGER,
  author_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  pass_score         INTEGER NOT NULL DEFAULT 60,
  time_limit_seconds INTEGER NOT NULL DEFAULT 0,
  attempts_allowed   INTEGER NOT NULL DEFAULT 3,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quiz_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id     INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'mcq' CHECK (type IN ('mcq','true_false','short')),
  text        TEXT NOT NULL,
  options     TEXT NOT NULL DEFAULT '[]',   -- JSON
  answer      TEXT NOT NULL,                -- JSON: [indexes] أو نص مقبول
  explanation TEXT,
  topic_tag   TEXT,
  points      INTEGER NOT NULL DEFAULT 1,
  "order"     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id          INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score            REAL NOT NULL DEFAULT 0,
  max_score        REAL NOT NULL DEFAULT 0,
  percent          REAL NOT NULL DEFAULT 0,
  passed           INTEGER NOT NULL DEFAULT 0,
  answers          TEXT NOT NULL DEFAULT '{}',
  topic_breakdown  TEXT NOT NULL DEFAULT '[]',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  finished_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON quiz_attempts(user_id, quiz_id);

-- ------------------------- توفّر المعلّم والباقات -------------------------
CREATE TABLE IF NOT EXISTS teacher_availability (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday       INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = الأحد
  start_time    TEXT NOT NULL,   -- HH:MM بتوقيت المعلّم
  end_time      TEXT NOT NULL,
  slot_minutes  INTEGER NOT NULL DEFAULT 60,
  break_minutes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_avail_teacher ON teacher_availability(teacher_id, weekday);

CREATE TABLE IF NOT EXISTS teacher_time_off (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  reason     TEXT
);

CREATE TABLE IF NOT EXISTS teacher_prices (
  teacher_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (30,45,60)),
  mode             TEXT NOT NULL CHECK (mode IN ('individual','group')),
  price            REAL NOT NULL,
  PRIMARY KEY (teacher_id, duration_minutes, mode)
);

CREATE TABLE IF NOT EXISTS lesson_packages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lessons_count    INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  mode             TEXT NOT NULL CHECK (mode IN ('individual','group')),
  price            REAL NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS package_purchases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id INTEGER NOT NULL REFERENCES lesson_packages(id) ON DELETE RESTRICT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  total      INTEGER NOT NULL,
  remaining  INTEGER NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  learner_id INTEGER REFERENCES learners(id) ON DELETE SET NULL   -- NULL = لأي متعلّم في الحساب
);

-- ------------------------- الحجوزات -------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id          INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  mode                TEXT NOT NULL CHECK (mode IN ('individual','group')),
  duration_minutes    INTEGER NOT NULL,
  starts_at           TEXT NOT NULL,   -- ISO UTC
  ends_at             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
                        'pending_payment','confirmed','in_progress','completed',
                        'cancelled_by_student','cancelled_by_teacher','no_show','disputed','expired')),
  price               REAL NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'OMR',
  order_id            INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  package_purchase_id INTEGER REFERENCES package_purchases(id) ON DELETE SET NULL,
  note                TEXT,
  expires_at          TEXT,            -- مهلة الدفع للحجز المعلّق
  cancelled_at        TEXT,
  cancel_reason       TEXT,
  refund_percent      INTEGER,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  learner_id          INTEGER REFERENCES learners(id) ON DELETE SET NULL   -- لمن الحصة (الحساب يبقى student_id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_student ON bookings(student_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_teacher ON bookings(teacher_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_learner ON bookings(learner_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_starts  ON bookings(starts_at);
-- منع التعارض: معلّم واحد لا يحمل حجزين فعّالين على البداية نفسها
CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_teacher_slot
  ON bookings(teacher_id, starts_at)
  WHERE status IN ('pending_payment','confirmed','in_progress');

CREATE TABLE IF NOT EXISTS booking_attendance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('student','teacher')),
  joined_at    TEXT NOT NULL,
  left_at      TEXT,
  reconnects   INTEGER NOT NULL DEFAULT 0,
  seconds      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_attendance_booking ON booking_attendance(booking_id);

CREATE TABLE IF NOT EXISTS booking_notes (
  booking_id   INTEGER PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  summary      TEXT,
  homework     TEXT,
  attachments  TEXT NOT NULL DEFAULT '[]',  -- JSON [{fileId,name}]
  suggest_next INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS live_rooms (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id       INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'internal',
  provider_room_id TEXT NOT NULL,
  opens_at         TEXT NOT NULL,
  closes_at        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','open','ended')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS room_participants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id          INTEGER NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash       TEXT NOT NULL,
  token_issued_at  TEXT NOT NULL DEFAULT (datetime('now')),
  token_expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES live_rooms(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------- التجارة -------------------------
CREATE TABLE IF NOT EXISTS carts (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coupon_code TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cart_items (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('book','course')),
  item_id   INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL CHECK (type IN ('percentage','fixed')),
  value       REAL NOT NULL,
  starts_at   TEXT,
  ends_at     TEXT,
  usage_limit INTEGER,
  user_limit  INTEGER,
  used_count  INTEGER NOT NULL DEFAULT 0,
  scope       TEXT NOT NULL DEFAULT '{}',   -- JSON {products?, teacherId?, category?}
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  PRIMARY KEY (coupon_id, order_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  number       TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subtotal     REAL NOT NULL DEFAULT 0,
  discount     REAL NOT NULL DEFAULT 0,
  tax          REAL NOT NULL DEFAULT 0,
  total        REAL NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'OMR',
  coupon_id    INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','partially_refunded','cancelled','expired')),
  provider     TEXT,
  provider_ref TEXT,
  paid_at      TEXT,
  expires_at   TEXT,
  meta         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  learner_id   INTEGER REFERENCES learners(id) ON DELETE SET NULL   -- نسبة الطلب لمتعلّم (للعرض فقط؛ الوصول للحساب)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(paid_at);

CREATE TABLE IF NOT EXISTS order_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_type      TEXT NOT NULL CHECK (item_type IN ('book','course','lesson','package','subscription')),
  item_id        INTEGER NOT NULL,
  title          TEXT NOT NULL,
  unit_price     REAL NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1,
  teacher_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  teacher_share  REAL NOT NULL DEFAULT 0,
  platform_share REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  provider_ref TEXT,
  amount       REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'OMR',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')),
  raw          TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refunds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  booking_id     INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  amount         REAL NOT NULL,
  reason         TEXT,
  policy_applied TEXT,     -- JSON snapshot من السياسة وقت الاسترجاع
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','rejected')),
  processed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at   TEXT
);

-- الحقيقة الوحيدة لـ«من يملك ماذا»
CREATE TABLE IF NOT EXISTS entitlements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type  TEXT NOT NULL CHECK (item_type IN ('book','course','subscription')),
  item_id    INTEGER NOT NULL,
  source     TEXT NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase','free','admin','gift','subscription')),
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_ent_user ON entitlements(user_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('topup','purchase','refund','adjustment','bonus')),
  amount        REAL NOT NULL,
  balance_after REAL NOT NULL,
  ref_type      TEXT,
  ref_id        INTEGER,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wallets (
  user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance  REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'OMR'
);

-- أرباح المعلّم: تُقيَّد pending عند الدفع، وتصبح available بعد اكتمال الحصة / نافذة الاسترجاع
CREATE TABLE IF NOT EXISTS teacher_earnings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('lesson','book','course','package')),
  source_id   INTEGER NOT NULL,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  gross       REAL NOT NULL,
  commission  REAL NOT NULL,
  net         REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','paid','reversed')),
  available_at TEXT,
  payout_id   INTEGER REFERENCES teacher_payouts(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_earnings_teacher ON teacher_earnings(teacher_id, status);

CREATE TABLE IF NOT EXISTS teacher_payouts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       REAL NOT NULL,
  method       TEXT,
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  note         TEXT,
  processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  slug     TEXT NOT NULL UNIQUE,
  price    REAL NOT NULL,
  interval TEXT NOT NULL CHECK (interval IN ('month','year')),
  includes TEXT NOT NULL DEFAULT '{}',
  active   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id    INTEGER NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  number     TEXT NOT NULL UNIQUE,
  file_id    INTEGER REFERENCES files(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------- التفاعل -------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('teacher','book','course')),
  target_id   INTEGER NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  gate_type   TEXT NOT NULL CHECK (gate_type IN ('booking','order','enrollment')),
  gate_id     INTEGER NOT NULL,      -- يثبت التجربة الحقيقية
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  hidden_reason TEXT,
  hidden_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_type, target_id);

CREATE TABLE IF NOT EXISTS favorites (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('book','course','teacher')),
  target_id   INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_type  TEXT CHECK (context_type IN ('booking','book','course')),
  context_id    INTEGER,
  last_message_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, teacher_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','file')),
  body            TEXT,
  file_id         INTEGER REFERENCES files(id) ON DELETE SET NULL,
  reply_to_id     INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  read_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS blocks (
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, blocked_user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('user','message','book','course','review')),
  target_id   INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  handled_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  data       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS device_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  token      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------- النظام -------------------------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL      -- JSON
);

CREATE TABLE IF NOT EXISTS content_reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('book','course')),
  entity_id   INTEGER NOT NULL,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  reason      TEXT,
  checklist   TEXT,    -- JSON {content, price, file, copyright, category, description}
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  meta       TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL   -- المستخدم المتأثّر بالإجراء (لصفحة الشخص)
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_user_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_logs(actor_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  props      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_name ON analytics_events(name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
