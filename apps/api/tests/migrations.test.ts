/** ترحيل قاعدة قديمة (v0 = schema.sql قبل المتعلّمين) على ملف مؤقّت: نسخة احتياطية، تعبئة، تكرار آمن، وشكل مطابق لقاعدة جديدة */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
let dir: string;
before(async () => { c = await boot(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manassah-mig-')); });
after(() => { c.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const here = path.dirname(fileURLToPath(import.meta.url));
const TOUCHED = ['users', 'learners', 'learner_subjects', 'bookings', 'orders', 'package_purchases', 'teacher_documents', 'reviews', 'audit_logs', 'otp_codes'];
const open = (file: string) => { const d = new Database(file); d.pragma('journal_mode = WAL'); d.pragma('foreign_keys = ON'); return d; };
const tableInfo = (d: Database.Database, t: string) =>
  (d.pragma(`table_info(${t})`) as any[]).map(x => ({ cid: x.cid, name: x.name, type: x.type, notnull: x.notnull, dflt: x.dflt_value, pk: x.pk }));
const indexNames = (d: Database.Database) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").pluck().all();

test('قاعدة v0: نسخة احتياطية، متعلّم لكل student_profiles، تعبئة الأعمدة، والتشغيل الثاني لا يغيّر شيئاً', async () => {
  const dbm = await import('../src/db/index.ts');
  const mig = await import('../src/db/migrations.ts');
  const file = path.join(dir, 'v0.db');
  const d = open(file);
  d.exec(fs.readFileSync(path.join(here, 'fixtures', 'schema-v0.sql'), 'utf8'));
  assert.equal(d.pragma('user_version', { simple: true }), 0);
  for (const col of ['active_learner_id']) assert.equal(mig.hasColumn(d, 'users', col), false);
  assert.equal(mig.hasTable(d, 'learners'), false);
  // منهج مصغّر
  d.exec(`INSERT INTO countries (id, code, name) VALUES (1,'OM','عُمان');
          INSERT INTO curriculums (id, country_id, name) VALUES (1,1,'عام');
          INSERT INTO grades (id, curriculum_id, name, "order") VALUES (12,1,'الصف ١٢',12);
          INSERT INTO semesters (id, curriculum_id, name, "order") VALUES (1,1,'الأول',1);
          INSERT INTO subjects (id, curriculum_id, name, slug) VALUES (1,1,'فيزياء','physics'), (2,1,'كيمياء','chemistry');`);
  // ٣ مستخدمين: طالب بصف ومادتين، موظّف دعم يدرّس، وحساب موقوف له تقدّم قراءة بلا ملف طالب — حجزان وطلب وسجلّ إيقاف
  d.exec(`INSERT INTO users (id, phone, status) VALUES (1,'+96890000101','active'), (2,'+96890000102','active'), (3,'+96890000103','suspended');
          INSERT INTO profiles (user_id, display_name, gender) VALUES (1,'سالم','male'), (2,'الدعم',NULL), (3,'','female');
          INSERT INTO student_profiles (user_id, curriculum_id, grade_id, semester_id, school) VALUES (1,1,12,1,'مدرسة');
          INSERT INTO student_subjects (user_id, subject_id) VALUES (1,1),(1,2);
          INSERT INTO user_roles (user_id, role) VALUES (1,'student'),(2,'support'),(2,'teacher'),(3,'student');
          INSERT INTO books (id, author_id, title, type, subject_id, grade_id, price, status) VALUES (1,2,'ملخّص','summary',1,12,3,'published');
          INSERT INTO reading_progress (user_id, book_id, last_page) VALUES (3,1,7);
          INSERT INTO bookings (id, student_id, teacher_id, subject_id, mode, duration_minutes, starts_at, ends_at, status, price) VALUES
            (1,1,2,1,'individual',60,'2026-01-01T13:00:00.000Z','2026-01-01T14:00:00.000Z','completed',6),
            (2,3,2,1,'individual',60,'2026-01-02T13:00:00.000Z','2026-01-02T14:00:00.000Z','completed',6);
          INSERT INTO orders (id, number, user_id, total, status) VALUES (1,'ORD-1',1,6,'paid');
          INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta, created_at) VALUES (2,'user.suspended','user',3,'{"reason":"بلاغات متكرّرة"}','2026-02-01 10:00:00');`);

  dbm.migrateDb(d, file, { backup: true });
  assert.equal(d.pragma('user_version', { simple: true }), mig.SCHEMA_VERSION);
  assert.ok(fs.readdirSync(dir).some(f => /^v0\.db\.bak-v0-\d+$/.test(f)), 'نسخة احتياطية قبل الترحيل');

  // متعلّم ذاتي واحد لصاحب student_profiles بصفّه ومواده واسمه وجنسه
  const learners = d.prepare('SELECT * FROM learners ORDER BY id').all() as any[];
  assert.equal(learners.length, 1);
  const l = learners[0];
  assert.equal(l.account_id, 1); assert.equal(l.is_self, 1); assert.equal(l.grade_id, 12); assert.equal(l.curriculum_id, 1); assert.equal(l.semester_id, 1);
  assert.equal(l.display_name, 'سالم'); assert.equal(l.gender, 'male'); assert.equal(l.school, 'مدرسة'); assert.equal(l.archived_at, null); assert.equal(l.position, 0);
  assert.deepEqual(d.prepare('SELECT subject_id FROM learner_subjects WHERE learner_id = ? ORDER BY subject_id').pluck().all(l.id), [1, 2]);
  // التقدّم يبقى على مستوى الحساب في هذا الإصدار: الحساب بلا ملف طالب لا يحصل على متعلّم وصفّه محفوظ
  assert.equal(d.prepare('SELECT last_page FROM reading_progress WHERE user_id = 3 AND book_id = 1').pluck().get(), 7);
  // تعبئة الأعمدة الجديدة
  assert.equal(d.prepare('SELECT learner_id FROM bookings WHERE id = 1').pluck().get(), l.id);
  assert.equal(d.prepare('SELECT learner_id FROM bookings WHERE id = 2').pluck().get(), null);
  assert.equal(d.prepare('SELECT learner_id FROM orders WHERE id = 1').pluck().get(), l.id);
  assert.equal(d.prepare('SELECT active_learner_id FROM users WHERE id = 1').pluck().get(), l.id);
  assert.equal(d.prepare('SELECT active_learner_id FROM users WHERE id = 2').pluck().get(), null);
  assert.deepEqual(d.prepare('SELECT status_reason, suspended_at, suspended_by FROM users WHERE id = 3').get(), { status_reason: 'بلاغات متكرّرة', suspended_at: '2026-02-01 10:00:00', suspended_by: 2 });
  assert.equal(d.prepare("SELECT target_user_id FROM audit_logs WHERE action = 'user.suspended'").pluck().get(), 3);
  for (const [t, col] of [['package_purchases', 'learner_id'], ['teacher_documents', 'reviewed_by'], ['teacher_documents', 'reviewed_at'], ['reviews', 'hidden_reason'], ['reviews', 'hidden_by'], ['otp_codes', 'provider'], ['otp_codes', 'via']]) assert.equal(mig.hasColumn(d, t, col), true, `${t}.${col}`);
  assert.ok(indexNames(d).includes('idx_otp_created'));
  assert.deepEqual(d.pragma('foreign_key_check'), []);

  // التشغيل الثاني: لا تغيير في الشكل ولا في الصفوف ولا نسخة احتياطية جديدة
  const snapshot = () => JSON.stringify({ info: TOUCHED.map(t => tableInfo(d, t)), counts: TOUCHED.map(t => d.prepare(`SELECT COUNT(*) FROM ${t}`).pluck().get()), version: d.pragma('user_version', { simple: true }) });
  const before = snapshot();
  dbm.migrateDb(d, file, { backup: true });
  assert.equal(snapshot(), before);
  assert.equal(fs.readdirSync(dir).filter(f => f.includes('.bak-')).length, 1, 'لا نسخة احتياطية بلا ترحيلات معلّقة');

  // الشكل النهائي مطابق لقاعدة جديدة من schema.sql
  const fresh = new Database(':memory:');
  dbm.migrateDb(fresh, ':memory:');
  assert.equal(fresh.pragma('user_version', { simple: true }), mig.SCHEMA_VERSION);
  for (const t of TOUCHED) assert.deepEqual(tableInfo(d, t), tableInfo(fresh, t), `table_info(${t})`);
  assert.deepEqual(indexNames(d), indexNames(fresh));
  fresh.close(); d.close();
});

test('قاعدة جديدة: user_version نهائي والترحيلات لا تفعل شيئاً و/api/health يعلن الإصدار', async () => {
  const mig = await import('../src/db/migrations.ts');
  assert.equal(c.db.pragma('user_version', { simple: true }), mig.SCHEMA_VERSION);
  assert.equal(mig.SCHEMA_VERSION, 3);
  const h = await c.api('/api/health');
  assert.equal(h.status, 200); assert.equal(h.json.schemaVersion, mig.SCHEMA_VERSION);
  assert.equal(c.q.val('SELECT COUNT(*) FROM sqlite_master WHERE type = ? AND name IN (?, ?)', 'table', 'learners', 'learner_subjects'), 2);
  assert.deepEqual(c.db.pragma('foreign_key_check'), []);
});

test('قاعدة v2 → v3: عمودا provider/via وفهرس created_at على otp_codes، والصفوف القديمة تصبح local/test', async () => {
  const dbm = await import('../src/db/index.ts');
  const mig = await import('../src/db/migrations.ts');
  const file = path.join(dir, 'v2.db');
  const d = open(file);
  // قاعدة v2 حقيقية: v0 + الترحيلان ١ و٢ يدوياً، كي لا يعمل إلا 003
  d.exec(fs.readFileSync(path.join(here, 'fixtures', 'schema-v0.sql'), 'utf8'));
  d.pragma('foreign_keys = OFF');
  for (const m of mig.MIGRATIONS.filter(m => m.version <= 2)) m.up(d);
  d.pragma('foreign_keys = ON');
  d.pragma('user_version = 2');
  d.exec("INSERT INTO otp_codes (channel, target, code_hash, expires_at) VALUES ('phone','+96890000001','h',0)");
  assert.equal(mig.hasColumn(d, 'otp_codes', 'provider'), false);
  dbm.migrateDb(d, file, { backup: false });
  assert.equal(d.pragma('user_version', { simple: true }), 3);
  assert.equal(mig.hasColumn(d, 'otp_codes', 'provider'), true); assert.equal(mig.hasColumn(d, 'otp_codes', 'via'), true);
  assert.ok(indexNames(d).includes('idx_otp_created'));
  assert.deepEqual(d.prepare('SELECT provider, via FROM otp_codes').get(), { provider: 'local', via: 'test' }, 'الصفوف القديمة لا تُحتسب إرسالاً حقيقياً');
  const fresh = new Database(':memory:');
  dbm.migrateDb(fresh, ':memory:');
  assert.deepEqual(tableInfo(d, 'otp_codes'), tableInfo(fresh, 'otp_codes'));
  fresh.close(); d.close();
});
