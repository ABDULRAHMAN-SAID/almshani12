-- ============================================================
--  منصّة "منصّة" التعليمية — مخطط قاعدة البيانات (SQLite)
-- ============================================================
PRAGMA foreign_keys = ON;

-- ------------------------- المستخدمون -------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  email           TEXT    NOT NULL UNIQUE,
  phone           TEXT,
  password_hash   TEXT    NOT NULL,
  role            TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('student','instructor','admin')),
  avatar          TEXT,
  bio             TEXT,
  country         TEXT,
  locale          TEXT    NOT NULL DEFAULT 'ar',
  wallet_balance  REAL    NOT NULL DEFAULT 0,
  referral_code   TEXT    UNIQUE,
  referred_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  verify_token    TEXT,
  reset_token     TEXT,
  reset_expires   INTEGER,
  status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  last_login_at   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  user_agent  TEXT,
  ip          TEXT,
  expires_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);

-- ملف المعلّم
CREATE TABLE IF NOT EXISTS instructor_profiles (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT,
  specialty      TEXT,
  headline       TEXT,
  website        TEXT,
  years_exp      INTEGER DEFAULT 0,
  rating_avg     REAL    NOT NULL DEFAULT 0,
  rating_count   INTEGER NOT NULL DEFAULT 0,
  students_count INTEGER NOT NULL DEFAULT 0,
  balance        REAL    NOT NULL DEFAULT 0,   -- أرباح قابلة للسحب
  lifetime_earnings REAL NOT NULL DEFAULT 0,
  commission_rate REAL   NOT NULL DEFAULT 0.20, -- عمولة المنصّة
  payout_method  TEXT,
  payout_details TEXT,
  approved       INTEGER NOT NULL DEFAULT 0,
  applied_at     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------- التصنيفات -------------------------
CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL UNIQUE,
  icon      TEXT,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  position  INTEGER NOT NULL DEFAULT 0
);

-- ------------------------- الدورات -------------------------
CREATE TABLE IF NOT EXISTS courses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title          TEXT    NOT NULL,
  slug           TEXT    NOT NULL UNIQUE,
  subtitle       TEXT,
  description    TEXT,
  level          TEXT    NOT NULL DEFAULT 'beginner' CHECK (level IN ('beginner','intermediate','advanced','all')),
  language       TEXT    NOT NULL DEFAULT 'ar',
  type           TEXT    NOT NULL DEFAULT 'recorded' CHECK (type IN ('recorded','live','hybrid')),
  price          REAL    NOT NULL DEFAULT 0,
  discount_price REAL,
  thumbnail      TEXT,
  promo_video    TEXT,
  outcomes       TEXT,   -- JSON array
  requirements   TEXT,   -- JSON array
  status         TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','rejected','archived')),
  reject_reason  TEXT,
  featured       INTEGER NOT NULL DEFAULT 0,
  rating_avg     REAL    NOT NULL DEFAULT 0,
  rating_count   INTEGER NOT NULL DEFAULT 0,
  students_count INTEGER NOT NULL DEFAULT 0,
  published_at   TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);
CREATE INDEX IF NOT EXISTS idx_courses_instructor ON courses(instructor_id);

CREATE TABLE IF NOT EXISTS sections (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title     TEXT    NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lessons (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_id       INTEGER REFERENCES sections(id) ON DELETE CASCADE,
  title            TEXT    NOT NULL,
  type             TEXT    NOT NULL DEFAULT 'video' CHECK (type IN ('video','article','pdf','quiz','live','audio')),
  content_url      TEXT,
  content_text     TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0,
  is_free_preview  INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id);

-- ------------------------- الحصص المباشرة -------------------------
CREATE TABLE IF NOT EXISTS live_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id        INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  instructor_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title            TEXT    NOT NULL,
  description      TEXT,
  cover            TEXT,
  starts_at        TEXT    NOT NULL,           -- ISO UTC
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  capacity         INTEGER NOT NULL DEFAULT 30,
  price            REAL    NOT NULL DEFAULT 0,
  meeting_provider TEXT    NOT NULL DEFAULT 'internal' CHECK (meeting_provider IN ('internal','zoom','meet','teams','other')),
  meeting_url      TEXT,
  room_code        TEXT    NOT NULL UNIQUE,
  status           TEXT    NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended','cancelled')),
  recording_url    TEXT,
  started_at       TEXT,
  ended_at         TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_starts ON live_sessions(starts_at);

CREATE TABLE IF NOT EXISTS live_bookings (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id         INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id           INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  status             TEXT    NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','attended','absent','cancelled','refunded')),
  joined_at          TEXT,
  left_at            TEXT,
  attendance_minutes INTEGER NOT NULL DEFAULT 0,
  rating             INTEGER,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, user_id)
);

CREATE TABLE IF NOT EXISTS live_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','question','system','hand')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_livemsg_session ON live_messages(session_id);

-- ------------------------- الكتب والملخصات -------------------------
CREATE TABLE IF NOT EXISTS books (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  author       TEXT NOT NULL,
  cover        TEXT,
  isbn         TEXT,
  publish_year INTEGER,
  pages        INTEGER,
  publisher    TEXT,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS summaries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id         INTEGER REFERENCES books(id) ON DELETE SET NULL,
  author_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- مُعِدّ الملخّص
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title           TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  book_title      TEXT,
  book_author     TEXT,
  cover           TEXT,
  description     TEXT,
  price           REAL    NOT NULL DEFAULT 0,
  discount_price  REAL,
  reading_minutes INTEGER NOT NULL DEFAULT 15,
  key_ideas       TEXT,   -- JSON array
  preview_content TEXT,   -- مقتطف مجاني (Markdown)
  content         TEXT,   -- المحتوى الكامل (Markdown)
  pdf_url         TEXT,
  audio_url       TEXT,
  status          TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','published','rejected','archived')),
  reject_reason   TEXT,
  featured        INTEGER NOT NULL DEFAULT 0,
  rating_avg      REAL    NOT NULL DEFAULT 0,
  rating_count    INTEGER NOT NULL DEFAULT 0,
  sales_count     INTEGER NOT NULL DEFAULT 0,
  published_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_summaries_status ON summaries(status);

-- ------------------------- الحزم -------------------------
CREATE TABLE IF NOT EXISTS bundles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  cover       TEXT,
  price       REAL NOT NULL DEFAULT 0,
  items       TEXT NOT NULL,  -- JSON: [{type,id}]
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------- الصلاحيات (ملكية المحتوى) -------------------------
CREATE TABLE IF NOT EXISTS entitlements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type  TEXT    NOT NULL CHECK (item_type IN ('course','summary','live_session','bundle')),
  item_id    INTEGER NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase','subscription','free','admin','bundle','gift')),
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  expires_at TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_ent_user ON entitlements(user_id);

-- ------------------------- التسجيل والتقدّم -------------------------
CREATE TABLE IF NOT EXISTS enrollments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id        INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  progress_percent REAL    NOT NULL DEFAULT 0,
  last_lesson_id   INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  completed_at     TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, course_id)
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id       INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed       INTEGER NOT NULL DEFAULT 0,
  seconds_watched INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id  INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  summary_id INTEGER REFERENCES summaries(id) ON DELETE CASCADE,
  at_seconds INTEGER,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wishlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type  TEXT    NOT NULL,
  item_id    INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, item_type, item_id)
);

-- ------------------------- السلة والطلبات والدفع -------------------------
CREATE TABLE IF NOT EXISTS cart_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type  TEXT    NOT NULL CHECK (item_type IN ('course','summary','live_session','bundle','plan')),
  item_id    INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS coupons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  type          TEXT    NOT NULL DEFAULT 'percent' CHECK (type IN ('percent','fixed')),
  value         REAL    NOT NULL,
  max_uses      INTEGER,
  used_count    INTEGER NOT NULL DEFAULT 0,
  min_amount    REAL    NOT NULL DEFAULT 0,
  applies_to    TEXT,   -- JSON: {type:'all'} | {type:'course',ids:[..]}
  instructor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  starts_at     TEXT,
  expires_at    TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  number       TEXT    NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subtotal     REAL    NOT NULL DEFAULT 0,
  discount     REAL    NOT NULL DEFAULT 0,
  tax          REAL    NOT NULL DEFAULT 0,
  total        REAL    NOT NULL DEFAULT 0,
  currency     TEXT    NOT NULL DEFAULT 'OMR',
  coupon_id    INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  provider     TEXT,
  provider_ref TEXT,
  paid_at      TEXT,
  meta         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_type        TEXT    NOT NULL,
  item_id          INTEGER NOT NULL,
  title            TEXT    NOT NULL,
  unit_price       REAL    NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1,
  instructor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  instructor_share REAL    NOT NULL DEFAULT 0,
  platform_share   REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider     TEXT    NOT NULL,
  provider_ref TEXT,
  amount       REAL    NOT NULL,
  currency     TEXT    NOT NULL DEFAULT 'OMR',
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')),
  receipt_url  TEXT,
  raw          TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- دفتر المحفظة (قيود مزدوجة مبسّطة)
CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT    NOT NULL CHECK (type IN ('topup','purchase','refund','payout','earning','referral','bonus','adjustment')),
  amount        REAL    NOT NULL,           -- موجب = إضافة، سالب = خصم
  balance_after REAL    NOT NULL,
  ref_type      TEXT,
  ref_id        INTEGER,
  note          TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);

CREATE TABLE IF NOT EXISTS payouts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        REAL    NOT NULL,
  method        TEXT,
  details       TEXT,
  status        TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')),
  note          TEXT,
  requested_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  processed_at  TEXT
);

-- ------------------------- الاشتراكات -------------------------
CREATE TABLE IF NOT EXISTS plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL UNIQUE,
  description  TEXT,
  price        REAL    NOT NULL,
  interval     TEXT    NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year')),
  features     TEXT,   -- JSON array
  includes     TEXT,   -- JSON: {courses:true, summaries:true, live_discount:0.3}
  active       INTEGER NOT NULL DEFAULT 1,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id    INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  starts_at  TEXT    NOT NULL,
  ends_at    TEXT    NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  order_id   INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);

-- ------------------------- التقييمات والأسئلة -------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type  TEXT    NOT NULL CHECK (item_type IN ('course','summary','live_session','instructor')),
  item_id    INTEGER NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  status     TEXT    NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, item_type, item_id)
);

CREATE TABLE IF NOT EXISTS questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id  INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  body       TEXT,
  resolved   INTEGER NOT NULL DEFAULT 0,
  votes      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT    NOT NULL,
  is_instructor INTEGER NOT NULL DEFAULT 0,
  accepted      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------- الاختبارات -------------------------
CREATE TABLE IF NOT EXISTS quizzes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id         INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id         INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  live_session_id   INTEGER REFERENCES live_sessions(id) ON DELETE CASCADE,
  instructor_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT    NOT NULL,
  description       TEXT,
  mode              TEXT    NOT NULL DEFAULT 'graded' CHECK (mode IN ('practice','graded','live')),
  pass_score        INTEGER NOT NULL DEFAULT 60,
  time_limit_seconds INTEGER NOT NULL DEFAULT 0,
  attempts_allowed  INTEGER NOT NULL DEFAULT 3,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id      INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  text         TEXT    NOT NULL,
  type         TEXT    NOT NULL DEFAULT 'single' CHECK (type IN ('single','multi','truefalse')),
  options      TEXT    NOT NULL,  -- JSON array
  correct      TEXT    NOT NULL,  -- JSON array of indexes
  points       INTEGER NOT NULL DEFAULT 1,
  explanation  TEXT,
  time_seconds INTEGER NOT NULL DEFAULT 20, -- للوضع المباشر
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id     INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       REAL    NOT NULL DEFAULT 0,
  max_score   REAL    NOT NULL DEFAULT 0,
  percent     REAL    NOT NULL DEFAULT 0,
  passed      INTEGER NOT NULL DEFAULT 0,
  answers     TEXT,
  started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

-- ------------------------- الشهادات -------------------------
CREATE TABLE IF NOT EXISTS certificates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  serial     TEXT    NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  grade      REAL,
  issued_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, course_id)
);

-- ------------------------- الإشعارات والنظام -------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL DEFAULT 'info',
  title      TEXT    NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  filename   TEXT NOT NULL,
  path       TEXT NOT NULL,
  mime       TEXT,
  size       INTEGER,
  purpose    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  meta       TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  subject    TEXT,
  body       TEXT NOT NULL,
  handled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
