import { Router } from 'express';
import { z } from 'zod';
import { UnitsQuery } from '@manassah/shared';
import { q } from '../db/index.ts';
import { validate, query } from '../lib/validate.ts';
import { attachUser } from '../lib/auth.ts';
import { bookCard, courseCard, teacherCard } from '../services/mappers.ts';

/** المنهج هرمي من قاعدة البيانات: دولة → منهج → صف → فصل → مادة → وحدة → درس */
const router = Router();

router.get('/tree', (_req, res) => {
  res.json({
    countries: q.all<any>('SELECT id, code, name FROM countries ORDER BY id'),
    curriculums: q.all<any>('SELECT id, country_id AS countryId, name FROM curriculums WHERE active = 1 ORDER BY id'),
    grades: q.all<any>('SELECT id, curriculum_id AS curriculumId, name, "order" FROM grades ORDER BY "order", id'),
    semesters: q.all<any>('SELECT id, curriculum_id AS curriculumId, name, "order" FROM semesters ORDER BY "order", id'),
    subjects: q.all<any>('SELECT id, curriculum_id AS curriculumId, name, slug, color_key AS colorKey FROM subjects ORDER BY "order", id'),
  });
});

router.get('/units', validate(UnitsQuery, 'query'), (req, res) => {
  const f = query<typeof UnitsQuery>(req);
  const units = q.all<any>(`SELECT id, subject_id AS subjectId, grade_id AS gradeId, semester_id AS semesterId, title, "order" FROM units
    WHERE subject_id = ? AND grade_id = ? ${f.semesterId ? 'AND semester_id = ?' : ''} ORDER BY "order", id`,
    ...(f.semesterId ? [f.subjectId, f.gradeId, f.semesterId] : [f.subjectId, f.gradeId]));
  res.json(units.map(u => ({ ...u, lessons: q.all<any>('SELECT id, unit_id AS unitId, title, "order" FROM curriculum_lessons WHERE unit_id = ? ORDER BY "order", id', u.id) })));
});

/** بحث موحّد بتطبيع عربي — كتب ودورات ومعلّمون ودروس المنهج */
const SearchQuery = z.object({ q: z.string().trim().min(1).max(120), gradeId: z.coerce.number().int().optional() });
router.get('/search', attachUser, validate(SearchQuery, 'query'), (req, res) => {
  const { q: term, gradeId } = query<typeof SearchQuery>(req);
  const uid = req.user?.id;
  const like = `%${term}%`;
  const gradeSql = gradeId ? 'AND grade_id = ?' : '';
  const gradeArg = gradeId ? [gradeId] : [];
  const books = q.all<any>(`SELECT b.* FROM books b JOIN subjects s ON s.id = b.subject_id WHERE b.status = 'published' ${gradeSql.replace('grade_id', 'b.grade_id')}
    AND (norm(b.title) LIKE norm(?) OR norm(s.name) LIKE norm(?) OR norm(b.tags) LIKE norm(?)) ORDER BY b.sales_count DESC LIMIT 12`, ...gradeArg, like, like, like);
  const courses = q.all<any>(`SELECT c.* FROM courses c JOIN subjects s ON s.id = c.subject_id WHERE c.status = 'published' ${gradeSql.replace('grade_id', 'c.grade_id')}
    AND (norm(c.title) LIKE norm(?) OR norm(s.name) LIKE norm(?)) ORDER BY c.sales_count DESC LIMIT 8`, ...gradeArg, like, like);
  const teachers = q.all<any>(`SELECT DISTINCT tp.*, p.display_name, p.avatar_path FROM teacher_profiles tp JOIN profiles p ON p.user_id = tp.user_id
    LEFT JOIN teacher_subjects ts ON ts.teacher_id = tp.user_id LEFT JOIN subjects s ON s.id = ts.subject_id
    WHERE tp.verification_status = 'verified' AND (norm(p.display_name) LIKE norm(?) OR norm(tp.headline) LIKE norm(?) OR norm(s.name) LIKE norm(?)) ORDER BY tp.rating_avg DESC LIMIT 8`, like, like, like);
  const lessons = q.all<any>(`SELECT cl.id, cl.title, u.title AS unit_title, s.name AS subject FROM curriculum_lessons cl JOIN units u ON u.id = cl.unit_id JOIN subjects s ON s.id = u.subject_id
    WHERE norm(cl.title) LIKE norm(?) ${gradeSql.replace('grade_id', 'u.grade_id')} LIMIT 10`, like, ...gradeArg)
    .map(r => ({ id: r.id, title: r.title, unitTitle: r.unit_title, subjectName: r.subject }));
  if (uid) q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', uid, 'search', JSON.stringify({ q: term }));
  res.json({
    books: books.map(b => bookCard(b, { userId: uid })),
    courses: courses.map(c => courseCard(c, { userId: uid })),
    teachers: teachers.map(t => teacherCard(t, { userId: uid, withNextSlot: false })),
    lessons,
  });
});

export default router;
