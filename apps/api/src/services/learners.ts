/**
 * المتعلّمون: ملفّات تعلّم مملوكة للحساب (D1). الوحدة الوحيدة التي تقرأ صفّ متعلّم بمعرّفه —
 * كل من يحتاج متعلّماً يمرّ من هنا: resolveLearner (ترويسة → users.active_learner_id → الافتراضي).
 * ما يخرج لأطراف أخرى (المعلّم…) هو LearnerRef فقط: لا هاتف ولا بريد ولا معرّف حساب (D11).
 * الجدولان القديمان student_profiles/student_subjects يُكتبان انعكاساً للمتعلّم الذاتي الأول (projectSelfLearner) ولا يُقرآن — يُحذفان في الإصدار التالي.
 */
import type { Request } from 'express';
import type { Learner, LearnerRef, LearnerUpsert, LearnerPatch } from '@manassah/shared';
import { config } from '../config.ts';
import { db, q, nowIso } from '../db/index.ts';
import { AppError, badRequest, conflict } from '../lib/errors.ts';
import { publicFileIdOf, RASTER_IMAGE } from './storage.ts';

export type LearnerRow = {
  id: number; account_id: number; display_name: string; gender: 'male' | 'female' | null; avatar_path: string | null;
  is_self: number; curriculum_id: number | null; grade_id: number | null; semester_id: number | null; school: string | null;
  position: number; archived_at: string | null; created_at: string; grade_name: string | null; semester_name: string | null;
};

/** الحد الأقصى للمتعلّمين غير المؤرشفين في الحساب (D12) */
export const MAX_LEARNERS = 6;

const SELECT = 'SELECT l.*, g.name AS grade_name, s.name AS semester_name FROM learners l LEFT JOIN grades g ON g.id = l.grade_id LEFT JOIN semesters s ON s.id = l.semester_id';
const ORDER = 'ORDER BY l.is_self DESC, l.position, l.id';

/** الصورة تُخزَّن كمسار نسبي (/api/files/public/:id) — نفس منطق mappers.publicUrlFromPath دون استيراد دائري */
const avatarUrl = (p: string | null | undefined): string | null =>
  !p ? null : p.startsWith('http') ? p : p.startsWith('/') ? `${config.publicUrl}${p}` : null;

const byId = (id: number): LearnerRow | null => q.get<LearnerRow>(`${SELECT} WHERE l.id = ?`, id) ?? null;
const subjectIdsOf = (learnerId: number): number[] =>
  q.all<{ subject_id: number }>('SELECT subject_id FROM learner_subjects WHERE learner_id = ? ORDER BY subject_id', learnerId).map(r => r.subject_id);
const countActive = (accountId: number): number =>
  q.val<number>('SELECT COUNT(*) FROM learners WHERE account_id = ? AND archived_at IS NULL', accountId) ?? 0;

function toLearner(row: LearnerRow): Learner {
  return {
    ...learnerRef(row),
    isSelf: !!row.is_self, gender: row.gender ?? null,
    curriculumId: row.curriculum_id, gradeId: row.grade_id,
    semesterId: row.semester_id, semesterName: row.semester_name ?? null,
    subjectIds: subjectIdsOf(row.id), school: row.school ?? null,
    position: row.position, archivedAt: row.archived_at ?? null, createdAt: row.created_at,
  };
}

/** {id, displayName, gradeName, avatarUrl} — لا شيء غيرها أبداً */
export function learnerRef(row: LearnerRow): LearnerRef {
  return { id: row.id, displayName: row.display_name, gradeName: row.grade_name ?? null, avatarUrl: avatarUrl(row.avatar_path) };
}
/** للمُخرِجات (bookingView/orderView): مرجع متعلّم بمعرّفه أو null إن حُذف نهائياً */
export function learnerRefById(id: number | null | undefined): LearnerRef | null {
  if (!id) return null;
  const row = byId(id);
  return row ? learnerRef(row) : null;
}

/** مراجع متعلّمي الحساب غير المؤرشفين (لشرائح الترشيح في تبويب الحصص) — الترتيب نفسه */
export function listLearnerRefs(accountId: number): LearnerRef[] {
  return q.all<LearnerRow>(`${SELECT} WHERE l.account_id = ? AND l.archived_at IS NULL ${ORDER}`, accountId).map(learnerRef);
}
/** عدد المتعلّمين غير المؤرشفين في الحساب */
export const countLearners = (accountId: number): number => countActive(accountId);

/** متعلّمو الحساب: غير المؤرشفين افتراضياً (المؤرشفون في النهاية عند طلبهم) بترتيب: الذاتي ثم position ثم id */
export function listLearners(accountId: number, includeArchived = false): Learner[] {
  const rows = includeArchived
    ? q.all<LearnerRow>(`${SELECT} WHERE l.account_id = ? ORDER BY l.archived_at IS NOT NULL, l.is_self DESC, l.position, l.id`, accountId)
    : q.all<LearnerRow>(`${SELECT} WHERE l.account_id = ? AND l.archived_at IS NULL ${ORDER}`, accountId);
  return rows.map(toLearner);
}

export function defaultLearner(accountId: number): LearnerRow | null {
  return q.get<LearnerRow>(`${SELECT} WHERE l.account_id = ? AND l.archived_at IS NULL ${ORDER} LIMIT 1`, accountId) ?? null;
}

/** متعلّم مملوك للحساب وغير مؤرشف — وإلا 403 learner_forbidden (معرّف قديم من جهاز آخر يتعافى بعد 403 واحدة) */
function ownedActive(accountId: number, learnerId: number): LearnerRow {
  const row = byId(learnerId);
  if (!row || row.account_id !== accountId || row.archived_at) throw new AppError('learner_forbidden', 'هذا المتعلّم ليس في حسابك', 403);
  return row;
}

/** الترتيب (D4): explicitId → headerId → users.active_learner_id → الافتراضي. null فقط حين لا متعلّم في الحساب. */
export function resolveLearnerForAccount(accountId: number, explicitId: number | null | undefined, headerId?: number | null): LearnerRow | null {
  if (explicitId) return ownedActive(accountId, explicitId);
  if (headerId) return ownedActive(accountId, headerId);
  const activeId = q.val<number | null>('SELECT active_learner_id FROM users WHERE id = ?', accountId);
  if (activeId) {
    const row = byId(activeId);
    if (row && row.account_id === accountId && !row.archived_at) return row;
  }
  return defaultLearner(accountId);
}

export function resolveLearner(req: Request, explicitId?: number | null): LearnerRow | null {
  return resolveLearnerForAccount(req.user!.id, explicitId ?? null, req.learnerId ?? null);
}

/** للحجز والدفع باسم متعلّم وكتابة التقدّم: 422 learner_required حين لا متعلّم */
export function requireLearner(req: Request, explicitId?: number | null): LearnerRow {
  const row = resolveLearner(req, explicitId);
  if (!row) throw new AppError('learner_required', 'اختر متعلّماً أولاً', 422);
  return row;
}

/* ---------- التحقّق ---------- */

/** الصف والفصل يتبعان المنهج؛ المواد تُرشَّح إلى المنهج (400 إن لم يبقَ شيء) — نفس قواعد /me/student-setup */
function validateScope(curriculumId: number, gradeId: number | null, semesterId: number | null, subjectIds?: number[]): number[] | undefined {
  if (!q.get('SELECT 1 FROM curriculums WHERE id = ?', curriculumId)) throw badRequest('المنهج غير موجود');
  if (gradeId != null && !q.get('SELECT 1 FROM grades WHERE id = ? AND curriculum_id = ?', gradeId, curriculumId)) throw badRequest('الصف أو الفصل لا يتبع هذا المنهج');
  if (semesterId != null && !q.get('SELECT 1 FROM semesters WHERE id = ? AND curriculum_id = ?', semesterId, curriculumId)) throw badRequest('الصف أو الفصل لا يتبع هذا المنهج');
  if (!subjectIds) return undefined;
  const valid = new Set(q.all<{ id: number }>('SELECT id FROM subjects WHERE curriculum_id = ?', curriculumId).map(r => r.id));
  const filtered = [...new Set(subjectIds)].filter(id => valid.has(id));
  if (!filtered.length) throw badRequest('اختر مادة واحدة على الأقل');
  return filtered;
}

/** صورة المتعلّم: ملف صورة يملكه الحساب (أو المنفّذ الإداري) يُجعل عاماً — كما في PATCH /me */
function avatarPathFor(accountId: number, fileId: number | null, actorId: number | null, prevPath: string | null = null): string | null {
  const prev = publicFileIdOf(prevPath);
  // إزالة الصورة أو استبدالها يجب أن يقطع الرابط العام للقديمة، وإلا بقيت صورة الطفل مقروءة للجميع بعد حذفها
  if (prev && prev !== fileId) q.run("UPDATE files SET visibility = 'private' WHERE id = ?", prev);
  if (!fileId) return null;
  const f = q.get<{ id: number; owner_id: number | null; mime: string; purpose: string }>('SELECT id, owner_id, mime, purpose FROM files WHERE id = ?', fileId);
  // الصورة تُنشر للعموم بلا توقيع، فلا تُقبل إلا ملفاً رُفع لهذا الغرض: قلبُ وثيقة هوية خاصة إلى عامة لا رجعة فيه
  if (!f || (f.owner_id !== accountId && f.owner_id !== actorId) || f.purpose !== 'avatar' || !RASTER_IMAGE.test(f.mime)) throw badRequest('الصورة غير صالحة');
  q.run("UPDATE files SET visibility = 'public' WHERE id = ?", f.id);
  return `/api/files/public/${f.id}`;
}

/** سجلّ التدقيق مع target_user_id (صاحب الحساب) — مباشر هنا لأن lib/audit.ts لا يحمل الحقل بعد */
function auditLearner(req: Request | null, action: string, learnerId: number, meta: unknown, accountId: number): void {
  q.run('INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta, ip, target_user_id) VALUES (?,?,?,?,?,?,?)',
    req?.user?.id ?? null, action, 'learners', learnerId, JSON.stringify(meta), req?.ip ?? null, accountId);
}

/* ---------- الكتابة ---------- */

export function createLearner(accountId: number, input: LearnerUpsert, actor: { req: Request; adminTarget?: boolean }): Learner {
  const req = actor.req;
  return db.transaction(() => {
    const subjectIds = validateScope(input.curriculumId, input.gradeId, input.semesterId, input.subjectIds)!;
    const count = countActive(accountId);
    if (count >= MAX_LEARNERS) throw conflict(`الحد الأقصى ${MAX_LEARNERS} متعلّمين لكل حساب`, 'learner_limit');
    const isSelf = input.isSelf ?? count === 0;
    const avatar = avatarPathFor(accountId, input.avatarFileId ?? null, req.user?.id ?? null);
    const now = nowIso();
    const id = Number(q.run(
      `INSERT INTO learners (account_id, display_name, gender, avatar_path, is_self, curriculum_id, grade_id, semester_id, school, position, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      accountId, input.displayName, input.gender ?? null, avatar, isSelf ? 1 : 0, input.curriculumId, input.gradeId, input.semesterId, input.school ?? null, count, now, now).lastInsertRowid);
    for (const sid of subjectIds) q.run('INSERT INTO learner_subjects (learner_id, subject_id) VALUES (?,?)', id, sid);
    // أول متعلّم يُكمل التهيئة ويصبح النشط؛ وإلا يصبح النشط فقط إن لم يكن هناك نشط
    if (count === 0) q.run('UPDATE users SET active_learner_id = ?, onboarding_completed = 1 WHERE id = ?', id, accountId);
    else q.run('UPDATE users SET active_learner_id = ? WHERE id = ? AND active_learner_id IS NULL', id, accountId);
    q.run('INSERT OR IGNORE INTO user_roles (user_id, role, granted_by) VALUES (?,?,?)', accountId, isSelf ? 'student' : 'parent', req.user?.id ?? null);
    projectSelfLearner(accountId);
    auditLearner(req, 'learner.create', id, { displayName: input.displayName, isSelf, gradeId: input.gradeId, admin: !!actor.adminTarget }, accountId);
    return toLearner(byId(id)!);
  })();
}

/** يعيد كتابة learner_subjects عند إرسال subjectIds؛ يتجاهل isSelf */
export function updateLearner(accountId: number, learnerId: number, input: LearnerPatch, req: Request): Learner {
  return db.transaction(() => {
    const row = ownedActive(accountId, learnerId);
    const curriculumId = input.curriculumId ?? row.curriculum_id;
    const gradeId = input.gradeId ?? row.grade_id;
    const semesterId = input.semesterId ?? row.semester_id;
    let subjectIds: number[] | undefined;
    if (input.curriculumId !== undefined || input.gradeId !== undefined || input.semesterId !== undefined || input.subjectIds !== undefined) {
      if (!curriculumId) throw badRequest('المنهج مطلوب');
      subjectIds = validateScope(curriculumId, gradeId, semesterId, input.subjectIds);
    }
    const avatar = input.avatarFileId === undefined ? row.avatar_path : avatarPathFor(accountId, input.avatarFileId, req.user?.id ?? null, row.avatar_path);
    q.run(`UPDATE learners SET display_name = ?, gender = ?, avatar_path = ?, curriculum_id = ?, grade_id = ?, semester_id = ?, school = ?, updated_at = ? WHERE id = ?`,
      input.displayName ?? row.display_name, input.gender === undefined ? row.gender : input.gender, avatar,
      curriculumId, gradeId, semesterId, input.school === undefined ? row.school : input.school, nowIso(), learnerId);
    if (subjectIds) {
      q.run('DELETE FROM learner_subjects WHERE learner_id = ?', learnerId);
      for (const sid of subjectIds) q.run('INSERT INTO learner_subjects (learner_id, subject_id) VALUES (?,?)', learnerId, sid);
    }
    projectSelfLearner(accountId);
    auditLearner(req, 'learner.update', learnerId, { fields: Object.keys(input).filter(k => k !== 'isSelf') }, accountId);
    return toLearner(byId(learnerId)!);
  })();
}

/** حذف ناعم: 409 إن كانت له حصص فعّالة أو كان آخر متعلّم؛ يُنقل النشط إلى الافتراضي */
export function archiveLearner(accountId: number, learnerId: number, req: Request): void {
  db.transaction(() => {
    const row = ownedActive(accountId, learnerId);
    if (q.get("SELECT 1 FROM bookings WHERE learner_id = ? AND status IN ('pending_payment','confirmed','in_progress')", learnerId)) {
      throw conflict('لا يمكن الحذف: لديه حصص قادمة', 'learner_has_upcoming');
    }
    if (countActive(accountId) <= 1) throw conflict('يجب أن يبقى متعلّم واحد على الأقل', 'last_learner');
    const now = nowIso();
    q.run('UPDATE learners SET archived_at = ?, updated_at = ? WHERE id = ?', now, now, learnerId);
    if (q.val<number | null>('SELECT active_learner_id FROM users WHERE id = ?', accountId) === learnerId) {
      q.run('UPDATE users SET active_learner_id = ? WHERE id = ?', defaultLearner(accountId)?.id ?? null, accountId);
    }
    projectSelfLearner(accountId);
    auditLearner(req, 'learner.archive', learnerId, { displayName: row.display_name }, accountId);
  })();
}

export function activateLearner(accountId: number, learnerId: number): void {
  ownedActive(accountId, learnerId);
  q.run('UPDATE users SET active_learner_id = ? WHERE id = ?', learnerId, accountId);
}

/** ترتيب جديد: كل معرّف يجب أن يكون متعلّماً غير مؤرشف في الحساب (بلا تكرار) وإلا 400؛ غير المذكورين يلحقون بترتيبهم الحالي */
export function reorderLearners(accountId: number, ids: number[]): void {
  const current = q.all<{ id: number }>(`SELECT l.id FROM learners l WHERE l.account_id = ? AND l.archived_at IS NULL ${ORDER}`, accountId).map(r => r.id);
  const known = new Set(current);
  if (new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) throw badRequest('قائمة المتعلّمين غير صحيحة');
  const order = [...ids, ...current.filter(id => !ids.includes(id))];
  db.transaction(() => {
    const now = nowIso();
    order.forEach((id, i) => q.run('UPDATE learners SET position = ?, updated_at = ? WHERE id = ?', i, now, id));
  })();
}

/** §1.5 الكتابة للجدولين القديمين: المتعلّم الذاتي الأقل ترتيباً فقط؛ بلا متعلّم ذاتي تُمسح صفوفه */
export function projectSelfLearner(accountId: number): void {
  const self = q.get<{ id: number; curriculum_id: number | null; grade_id: number | null; semester_id: number | null; school: string | null }>(
    'SELECT id, curriculum_id, grade_id, semester_id, school FROM learners WHERE account_id = ? AND is_self = 1 AND archived_at IS NULL ORDER BY position, id LIMIT 1', accountId);
  q.run('DELETE FROM student_subjects WHERE user_id = ?', accountId);
  if (!self) { q.run('DELETE FROM student_profiles WHERE user_id = ?', accountId); return; }
  q.run(`INSERT INTO student_profiles (user_id, curriculum_id, grade_id, semester_id, school, updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET curriculum_id = excluded.curriculum_id, grade_id = excluded.grade_id, semester_id = excluded.semester_id, school = excluded.school, updated_at = excluded.updated_at`,
    accountId, self.curriculum_id, self.grade_id, self.semester_id, self.school, nowIso());
  q.run('INSERT INTO student_subjects (user_id, subject_id) SELECT ?, subject_id FROM learner_subjects WHERE learner_id = ?', accountId, self.id);
}
