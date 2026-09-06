import { z } from 'zod';
import { Id, Money, Currency, IsoDateTime, PageQuery } from './common';
import { SubjectRef, GradeRef } from './catalog';

export const BookType = z.enum([
  'summary', 'exercises', 'solved_problems', 'final_review', 'question_bank',
  'english_book', 'grammar', 'vocabulary', 'foundation', 'exam_models',
]);
export type BookType = z.infer<typeof BookType>;

export const BookBadge = z.enum(['bestseller', 'new', 'updated', 'verified', 'free']);
export const ContentStatus = z.enum(['draft', 'pending_review', 'approved', 'rejected', 'published', 'archived']);
export type ContentStatus = z.infer<typeof ContentStatus>;

export const AuthorRef = z.object({ id: Id, name: z.string(), avatarUrl: z.string().nullable(), verified: z.boolean() });

export const BookCard = z.object({
  id: Id,
  title: z.string(),
  type: BookType,
  subject: SubjectRef,
  grade: GradeRef,
  semesterName: z.string().nullable(),
  author: AuthorRef,
  price: Money,
  currency: Currency,
  ratingAvg: z.number(),
  ratingCount: z.number().int(),
  salesCount: z.number().int(),
  coverUrl: z.string().nullable(),
  badges: z.array(BookBadge),
  owned: z.boolean(),
  favorited: z.boolean(),
});
export type BookCard = z.infer<typeof BookCard>;

export const TocEntry = z.object({ title: z.string(), page: z.number().int().nullable() });
export const ReviewItem = z.object({
  id: Id, rating: z.number().int().min(1).max(5), comment: z.string().nullable(),
  userName: z.string(), userAvatarUrl: z.string().nullable(), createdAt: IsoDateTime,
});

export const BookDetail = BookCard.extend({
  description: z.string(),
  learnPoints: z.array(z.string()),
  toc: z.array(TocEntry),
  pages: z.number().int().nullable(),
  edition: z.string().nullable(),
  version: z.string().nullable(),
  updatedAt: IsoDateTime,
  language: z.string(),
  level: z.string().nullable(),
  previewPages: z.number().int(),
  samplePageUrls: z.array(z.string()),
  reviews: z.array(ReviewItem),
  similar: z.array(BookCard),
  byAuthor: z.array(BookCard),
  canReview: z.boolean(),
});
export type BookDetail = z.infer<typeof BookDetail>;

export const BooksQuery = PageQuery.extend({
  q: z.string().trim().max(120).optional(),
  gradeId: z.coerce.number().int().optional(),
  subjectId: z.coerce.number().int().optional(),
  semesterId: z.coerce.number().int().optional(),
  type: BookType.optional(),
  free: z.coerce.boolean().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  sort: z.enum(['bestselling', 'newest', 'rating', 'price_asc', 'price_desc']).default('bestselling'),
});
export type BooksQuery = z.infer<typeof BooksQuery>;

/** رابط موقّع قصير العمر — لا يُخزَّن ولا يُشارَك */
export const BookReadAccess = z.object({
  kind: z.enum(['full', 'preview']),
  url: z.string(),
  expiresAt: IsoDateTime,
  watermark: z.string().nullable(),
  lastPage: z.number().int().nullable(),
  bookmarks: z.array(z.number().int()),
});
export type BookReadAccess = z.infer<typeof BookReadAccess>;

export const ReaderProgress = z.object({ page: z.number().int().min(1) });
export const BookmarkToggle = z.object({ page: z.number().int().min(1) });

export const BookUpsert = z.object({
  title: z.string().trim().min(3).max(160),
  type: BookType,
  subjectId: Id, gradeId: Id, semesterId: Id.nullable(),
  description: z.string().trim().max(5000),
  learnPoints: z.array(z.string().trim().max(200)).max(12).default([]),
  toc: z.array(TocEntry).max(200).default([]),
  price: Money,
  pages: z.number().int().positive().nullable(),
  edition: z.string().trim().max(40).nullable(),
  version: z.string().trim().max(20).nullable(),
  language: z.enum(['ar', 'en']).default('ar'),
  level: z.string().trim().max(40).nullable(),
  previewPages: z.number().int().min(0).max(50).default(5),
  tags: z.array(z.string().trim().max(30)).max(10).default([]),
});
