import { z } from 'zod';
import { Id } from './common';

export const Country = z.object({ id: Id, code: z.string(), name: z.string() });
export const Curriculum = z.object({ id: Id, countryId: Id, name: z.string() });
export const Grade = z.object({ id: Id, curriculumId: Id, name: z.string(), order: z.number().int() });
export const Semester = z.object({ id: Id, curriculumId: Id, name: z.string(), order: z.number().int() });

export const SubjectColorKey = z.enum([
  'math', 'physics', 'chemistry', 'biology', 'arabic', 'english', 'islamic', 'social', 'default',
]);

export const Subject = z.object({
  id: Id,
  curriculumId: Id,
  name: z.string(),
  slug: z.string(),
  colorKey: SubjectColorKey,
});
export type Subject = z.infer<typeof Subject>;

export const SubjectRef = Subject.pick({ id: true, name: true, colorKey: true });
export const GradeRef = Grade.pick({ id: true, name: true });

export const Unit = z.object({
  id: Id, subjectId: Id, gradeId: Id, semesterId: Id, title: z.string(), order: z.number().int(),
});
export const CurriculumLesson = z.object({ id: Id, unitId: Id, title: z.string(), order: z.number().int() });

/** الشجرة الكاملة لمنهج واحد — تُحمَّل مرّة عند الإعداد */
export const CatalogTree = z.object({
  countries: z.array(Country),
  curriculums: z.array(Curriculum),
  grades: z.array(Grade),
  semesters: z.array(Semester),
  subjects: z.array(Subject),
});
export type CatalogTree = z.infer<typeof CatalogTree>;

export const UnitsQuery = z.object({
  subjectId: z.coerce.number().int().positive(),
  gradeId: z.coerce.number().int().positive(),
  semesterId: z.coerce.number().int().positive().optional(),
});
export const UnitsTree = z.array(Unit.extend({ lessons: z.array(CurriculumLesson) }));
