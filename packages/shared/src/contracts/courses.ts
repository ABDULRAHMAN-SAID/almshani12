import { z } from 'zod';
import { Id, Money, Currency, IsoDateTime, PageQuery } from './common';
import { SubjectRef, GradeRef } from './catalog';
import { AuthorRef, ReviewItem, ContentStatus } from './books';

export const CourseCard = z.object({
  id: Id,
  title: z.string(),
  coverUrl: z.string().nullable(),
  teacher: AuthorRef,
  subject: SubjectRef,
  grade: GradeRef,
  lessonsCount: z.number().int(),
  totalMinutes: z.number().int(),
  ratingAvg: z.number(),
  ratingCount: z.number().int(),
  price: Money,
  currency: Currency,
  enrolled: z.boolean(),
  progressPercent: z.number().min(0).max(100).nullable(),
  favorited: z.boolean(),
});
export type CourseCard = z.infer<typeof CourseCard>;

export const CourseLessonKind = z.enum(['video', 'quiz', 'reading']);
export const CourseLessonItem = z.object({
  id: Id,
  title: z.string(),
  kind: CourseLessonKind,
  durationSeconds: z.number().int(),
  isPreview: z.boolean(),
  completed: z.boolean(),
  locked: z.boolean(),
});
export const CourseSection = z.object({ id: Id, title: z.string(), lessons: z.array(CourseLessonItem) });

export const CourseDetail = CourseCard.extend({
  trailerUrl: z.string().nullable(),
  description: z.string(),
  learnPoints: z.array(z.string()),
  requirements: z.array(z.string()),
  sections: z.array(CourseSection),
  reviews: z.array(ReviewItem),
  canReview: z.boolean(),
  status: ContentStatus,
});
export type CourseDetail = z.infer<typeof CourseDetail>;

export const CoursesQuery = PageQuery.extend({
  q: z.string().trim().max(120).optional(),
  gradeId: z.coerce.number().int().optional(),
  subjectId: z.coerce.number().int().optional(),
  teacherId: z.coerce.number().int().optional(),
  sort: z.enum(['popular', 'newest', 'rating', 'price_asc']).default('popular'),
});

/** رابط فيديو موقّع + آخر موضع وصل إليه الطالب */
export const PlayLesson = z.object({
  lesson: CourseLessonItem,
  videoUrl: z.string().nullable(),
  readingBody: z.string().nullable(),
  quizId: Id.nullable(),
  positionSeconds: z.number().int(),
  expiresAt: IsoDateTime,
  next: CourseLessonItem.nullable(),
  prev: CourseLessonItem.nullable(),
});
export type PlayLesson = z.infer<typeof PlayLesson>;

export const LessonProgressUpdate = z.object({
  positionSeconds: z.number().int().min(0),
  completed: z.boolean().optional(),
});

/* ---------- الاختبارات ---------- */
export const QuestionType = z.enum(['mcq', 'true_false', 'short']);
export const QuizQuestion = z.object({
  id: Id,
  type: QuestionType,
  text: z.string(),
  options: z.array(z.string()),
  points: z.number().int(),
  topicTag: z.string().nullable(),
});
export const Quiz = z.object({
  id: Id,
  title: z.string(),
  passScore: z.number().int(),
  timeLimitSeconds: z.number().int(),
  attemptsAllowed: z.number().int(),
  attemptsUsed: z.number().int(),
  questions: z.array(QuizQuestion),
});
export const QuizSubmit = z.object({
  answers: z.record(z.string(), z.union([z.array(z.number().int()), z.string()])),
  durationSeconds: z.number().int().min(0),
});
export const QuizResult = z.object({
  attemptId: Id,
  score: z.number(),
  maxScore: z.number(),
  percent: z.number(),
  passed: z.boolean(),
  durationSeconds: z.number().int(),
  breakdown: z.array(z.object({
    questionId: Id, correct: z.boolean(), given: z.any(), answer: z.any(), explanation: z.string().nullable(),
  })),
  /** «راجع نقاط ضعفك» — نسبة الصواب لكل موضوع */
  topics: z.array(z.object({ topic: z.string(), percent: z.number(), total: z.number().int() })),
});
export type QuizResult = z.infer<typeof QuizResult>;
