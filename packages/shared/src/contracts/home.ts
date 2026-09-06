import { z } from 'zod';
import { Id } from './common';
import { BookCard } from './books';
import { CourseCard } from './courses';
import { TeacherCard } from './teachers';
import { Booking } from './bookings';

export const QuickAction = z.enum(['book_teacher', 'buy_summary', 'solve_problems', 'courses', 'quick_quiz']);

export const ContinueItem = z.object({
  type: z.enum(['book', 'course', 'quiz']),
  id: Id,
  title: z.string(),
  subtitle: z.string().nullable(),
  coverUrl: z.string().nullable(),
  progressPercent: z.number().min(0).max(100),
});

/** الصفحة الرئيسية — الترتيب ملزم: الحصة القادمة أولاً */
export const HomeFeed = z.object({
  greeting: z.object({ name: z.string(), gradeName: z.string().nullable(), unreadNotifications: z.number().int() }),
  nextLesson: Booking.nullable(),
  continueItems: z.array(ContinueItem),
  gradeSummaries: z.array(BookCard),
  courses: z.array(CourseCard),
  recommendedTeachers: z.array(TeacherCard),
  solvedProblems: z.array(BookCard),
  trending: z.array(BookCard),
  offers: z.array(z.object({ id: Id, title: z.string(), subtitle: z.string().nullable(), code: z.string().nullable() })),
});
export type HomeFeed = z.infer<typeof HomeFeed>;

export const ProgressDashboard = z.object({
  week: z.object({
    lessons: z.number().int(),
    learningMinutes: z.number().int(),
    quizzes: z.number().int(),
    avgScore: z.number().nullable(),
  }),
  bySubject: z.array(z.object({ subjectId: Id, name: z.string(), colorKey: z.string(), percent: z.number() })),
  weakTopics: z.array(z.object({ topic: z.string(), percent: z.number(), subjectName: z.string() })),
});
export type ProgressDashboard = z.infer<typeof ProgressDashboard>;

export const SearchResults = z.object({
  books: z.array(BookCard),
  courses: z.array(CourseCard),
  teachers: z.array(TeacherCard),
  lessons: z.array(z.object({ id: Id, title: z.string(), unitTitle: z.string(), subjectName: z.string() })),
});
