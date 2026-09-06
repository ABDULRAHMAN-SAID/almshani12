/**
 * ترحيلات مرقّمة على PRAGMA user_version — تعمل على القواعد القديمة فقط.
 * القاعدة الجديدة تأخذ شكلها النهائي من schema.sql ثم تمرّ الترحيلات كلا شيء (تعبئات لا تجد صفوفاً).
 * كل `up` مكتفٍ بذاته (ينشئ ما يحتاجه بـ IF NOT EXISTS / حراسة الأعمدة) كي يُعاد تشغيله بأمان.
 * قبل أي ترحيل معلّق تُؤخذ نسخة احتياطية بـ VACUUM INTO — وإن فشلت نرفض الإقلاع.
 * يدوياً قبل الترقية: cp data/manassah.db data/manassah.db.bak
 */
import type Database from 'better-sqlite3';

export type Migration = { version: number; name: string; up: (db: Database.Database) => void };

export const hasTable = (db: Database.Database, table: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
export const hasColumn = (db: Database.Database, table: string, col: string): boolean =>
  (db.pragma(`table_info(${table})`) as { name: string }[]).some(c => c.name === col);
/** يضيف عموداً إن لم يكن موجوداً — آمن للتكرار */
export const addColumn = (db: Database.Database, table: string, col: string, ddl: string): void => {
  if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
};

/** المتعلّم الافتراضي للحساب: غير مؤرشف، الذاتي أولاً ثم الترتيب ثم المعرّف */
const DEFAULT_LEARNER = `(SELECT id FROM learners l WHERE l.account_id = %ACC% AND l.archived_at IS NULL ORDER BY l.is_self DESC, l.position, l.id LIMIT 1)`;

/** نسخة مجمّدة من DDL جداول المتعلّمين (مطابقة لـ schema.sql) — الترحيل لا يفترض أن schema.sql نُفّذ قبله على قاعدة قديمة */
const LEARNER_TABLES = `
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
);`;

/** الفهارس المستحدثة — نفسها في schema.sql */
const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_bookings_learner ON bookings(learner_id, starts_at)',
  'CREATE INDEX IF NOT EXISTS idx_bookings_starts ON bookings(starts_at)',
  'CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(paid_at)',
  'CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_user_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id)',
  'CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at)',
];

export const MIGRATIONS: Migration[] = [
  { version: 1, name: '001_learners', up: (db) => {
    db.exec(LEARNER_TABLES);
    // متعلّم ذاتي واحد لكل صف في student_profiles (الحسابات التي لم تحصل على متعلّم بعد)
    db.exec(`INSERT INTO learners (account_id, display_name, gender, is_self, curriculum_id, grade_id, semester_id, school, position)
             SELECT sp.user_id, COALESCE(NULLIF(p.display_name,''), 'طالب'), p.gender, 1, sp.curriculum_id, sp.grade_id, sp.semester_id, sp.school, 0
             FROM student_profiles sp LEFT JOIN profiles p ON p.user_id = sp.user_id
             WHERE NOT EXISTS (SELECT 1 FROM learners l WHERE l.account_id = sp.user_id)`);
    db.exec(`INSERT OR IGNORE INTO learner_subjects (learner_id, subject_id)
             SELECT l.id, ss.subject_id FROM student_subjects ss JOIN learners l ON l.account_id = ss.user_id AND l.is_self = 1`);
  } },
  { version: 2, name: '002_columns', up: (db) => {
    addColumn(db, 'users', 'active_learner_id', 'INTEGER REFERENCES learners(id) ON DELETE SET NULL');
    addColumn(db, 'users', 'status_reason', 'TEXT');
    addColumn(db, 'users', 'suspended_at', 'TEXT');
    addColumn(db, 'users', 'suspended_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
    addColumn(db, 'bookings', 'learner_id', 'INTEGER REFERENCES learners(id) ON DELETE SET NULL');
    addColumn(db, 'orders', 'learner_id', 'INTEGER REFERENCES learners(id) ON DELETE SET NULL');
    addColumn(db, 'package_purchases', 'learner_id', 'INTEGER REFERENCES learners(id) ON DELETE SET NULL');
    addColumn(db, 'teacher_documents', 'reviewed_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
    addColumn(db, 'teacher_documents', 'reviewed_at', 'TEXT');
    addColumn(db, 'reviews', 'hidden_reason', 'TEXT');
    addColumn(db, 'reviews', 'hidden_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
    addColumn(db, 'audit_logs', 'target_user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
    for (const sql of INDEXES) db.exec(sql);
    // تعبئة: المتعلّم الافتراضي للحساب (الباقات تبقى NULL = لأي متعلّم)
    db.exec(`UPDATE users SET active_learner_id = ${DEFAULT_LEARNER.replace('%ACC%', 'users.id')} WHERE active_learner_id IS NULL`);
    db.exec(`UPDATE bookings SET learner_id = ${DEFAULT_LEARNER.replace('%ACC%', 'bookings.student_id')} WHERE learner_id IS NULL`);
    db.exec(`UPDATE orders SET learner_id = ${DEFAULT_LEARNER.replace('%ACC%', 'orders.user_id')} WHERE learner_id IS NULL`);
    // سبب الإيقاف من آخر سجلّ تدقيق (الشيفرة الحالية تسجّل entity='user' والمواصفة 'users' — نقبل الاثنين)
    const lastSuspend = (col: string) => `(SELECT ${col} FROM audit_logs a WHERE a.action = 'user.suspended' AND a.entity IN ('user','users') AND a.entity_id = users.id ORDER BY a.id DESC LIMIT 1)`;
    db.exec(`UPDATE users SET status_reason = ${lastSuspend("json_extract(a.meta,'$.reason')")}, suspended_at = ${lastSuspend('a.created_at')}, suspended_by = ${lastSuspend('a.actor_id')}
             WHERE status = 'suspended' AND status_reason IS NULL`);
    db.exec(`UPDATE audit_logs SET target_user_id = entity_id WHERE target_user_id IS NULL AND entity IN ('user','users','teacher','teachers')
             AND EXISTS (SELECT 1 FROM users u WHERE u.id = audit_logs.entity_id)`);
  } },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * يطبّق الترحيلات المعلّقة بالترتيب، كل واحد في معاملة، مع foreign_keys مغلقة أثناءه وفحص foreign_key_check بعده.
 * النسخة الاحتياطية: افتراضياً لملفّات حقيقية خارج الاختبارات؛ opts.backup يفرض/يمنع صراحة.
 */
export function runMigrations(db: Database.Database, dbFile: string, opts: { backup?: boolean } = {}): number {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = MIGRATIONS.filter(m => m.version > current);
  if (!pending.length) return 0;
  const backup = opts.backup ?? (dbFile !== ':memory:' && process.env.NODE_ENV !== 'test');
  if (backup) {
    const bak = `${dbFile}.bak-v${current}-${Date.now()}`;
    try { db.pragma('wal_checkpoint(TRUNCATE)'); db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`); }
    catch (e) { console.error('[migrate] backup failed, refusing to boot', e); process.exit(1); }
    console.log(`[migrate] backup ${bak}`);
  }
  for (const m of pending) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => { m.up(db); db.pragma(`user_version = ${m.version}`); })();
    } finally { db.pragma('foreign_keys = ON'); }
    const bad = db.pragma('foreign_key_check') as unknown[];
    if (bad.length) { console.error('[migrate] foreign_key_check failed after', m.name, bad.slice(0, 5)); process.exit(1); }
    console.log(`[migrate] applied ${m.name}`);
  }
  return pending.length;
}
