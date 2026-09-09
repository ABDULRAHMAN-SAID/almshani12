import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { BooksQuery, BookUpsert, ReaderProgress, BookmarkToggle } from '@manassah/shared';
import { config } from '../config.ts';
import { db, q, json, nowIso } from '../db/index.ts';
import { AppError, asyncHandler, notFound, forbidden, badRequest } from '../lib/errors.ts';
import { validate, body, query, idParam } from '../lib/validate.ts';
import { attachUser, requireAuth, requireVerifiedTeacher, hasRole } from '../lib/auth.ts';
import { paginate, pageMeta, money, iso } from '../lib/helpers.ts';
import { checkAccess, ownedIds, favoriteIds } from '../services/access.ts';
import { signedUrl, upload, storeUpload, publicUrl, deleteFile, RASTER_IMAGE } from '../services/storage.ts';
import { bookCard, reviewItems } from '../services/mappers.ts';
import { notifyStaff } from '../services/notifications.ts';

const router = Router();

/* ---------- القائمة والتصفية ---------- */
router.get('/', attachUser, validate(BooksQuery, 'query'), (req, res) => {
  const f = query<typeof BooksQuery>(req);
  const where = ["b.status = 'published'"];
  const params: unknown[] = [];
  if (f.q) { where.push('(norm(b.title) LIKE norm(?) OR norm(s.name) LIKE norm(?) OR norm(b.tags) LIKE norm(?))'); params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  if (f.gradeId) { where.push('b.grade_id = ?'); params.push(f.gradeId); }
  if (f.subjectId) { where.push('b.subject_id = ?'); params.push(f.subjectId); }
  if (f.semesterId) { where.push('(b.semester_id = ? OR b.semester_id IS NULL)'); params.push(f.semesterId); }
  if (f.type) { where.push('b.type = ?'); params.push(f.type); }
  if (f.free) where.push('b.price = 0');
  if (f.minPrice != null) { where.push('b.price >= ?'); params.push(f.minPrice); }
  if (f.maxPrice != null) { where.push('b.price <= ?'); params.push(f.maxPrice); }
  if (f.minRating != null) { where.push('b.rating_avg >= ?'); params.push(f.minRating); }
  const order = { bestselling: 'b.sales_count DESC, b.rating_avg DESC', newest: 'b.published_at DESC', rating: 'b.rating_avg DESC, b.rating_count DESC', price_asc: 'b.price ASC', price_desc: 'b.price DESC' }[f.sort];
  const from = `FROM books b JOIN subjects s ON s.id = b.subject_id WHERE ${where.join(' AND ')}`;
  const total = q.val<number>(`SELECT COUNT(*) ${from}`, ...params) ?? 0;
  const { limit, offset } = paginate(f.page, f.limit);
  const rows = q.all<any>(`SELECT b.* ${from} ORDER BY ${order}, b.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  const ctx = { userId: req.user?.id, owned: ownedIds(req.user?.id, 'book'), fav: favoriteIds(req.user?.id, 'book') };
  res.json({ data: rows.map(b => bookCard(b, ctx)), meta: pageMeta(total, f.page, f.limit) });
});

/** كتب المعلّم نفسه (كل الحالات) */
router.get('/mine', requireAuth, (req, res) => {
  const rows = q.all<any>('SELECT * FROM books WHERE author_id = ? ORDER BY id DESC LIMIT 200', req.user!.id);
  const mineCtx = { userId: req.user!.id, owned: ownedIds(req.user!.id, 'book'), fav: favoriteIds(req.user!.id, 'book') };
  res.json(rows.map(b => ({ ...bookCard(b, mineCtx), status: b.status, rejectReason: b.reject_reason, hasFile: !!q.get("SELECT 1 FROM book_files WHERE book_id = ? AND kind = 'full'", b.id) })));
});

/* ---------- صفحة الكتاب ---------- */
router.get('/:id', attachUser, (req, res) => {
  const id = idParam(req);
  const uid = req.user?.id;
  const b = q.get<any>('SELECT * FROM books WHERE id = ?', id);
  const staff = hasRole(req.user, 'content_reviewer');
  if (!b || (b.status !== 'published' && b.author_id !== uid && !staff)) throw notFound('الكتاب غير موجود');
  const ctx = { userId: uid, owned: ownedIds(uid, 'book'), fav: favoriteIds(uid, 'book') };
  const card = bookCard(b, ctx);
  const samples = q.all<{ file_id: number }>("SELECT file_id FROM book_files WHERE book_id = ? AND kind = 'sample_page' ORDER BY \"order\"", id);
  const similar = q.all<any>("SELECT * FROM books WHERE status = 'published' AND id <> ? AND subject_id = ? AND grade_id = ? ORDER BY sales_count DESC LIMIT 6", id, b.subject_id, b.grade_id);
  const byAuthor = q.all<any>("SELECT * FROM books WHERE status = 'published' AND id <> ? AND author_id = ? ORDER BY sales_count DESC LIMIT 6", id, b.author_id);
  const canReview = !!uid && card.owned && !q.get('SELECT 1 FROM reviews WHERE user_id = ? AND target_type = ? AND target_id = ?', uid, 'book', id);
  if (uid) q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', uid, 'book_view', JSON.stringify({ id }));
  res.json({
    ...card,
    description: b.description, learnPoints: json<string[]>(b.learn_points, []),
    toc: q.all<any>('SELECT title, page FROM book_toc WHERE book_id = ? ORDER BY "order", id', id),
    pages: b.pages, edition: b.edition, version: b.version, updatedAt: iso(b.updated_at), language: b.language, level: b.level,
    previewPages: b.preview_pages,
    samplePageUrls: samples.map(s => signedUrl(s.file_id, uid ?? 0, 3600).url),
    reviews: reviewItems('book', id), similar: similar.map(x => bookCard(x, ctx)), byAuthor: byAuthor.map(x => bookCard(x, ctx)),
    canReview, status: b.status,
  });
});

/**
 * القراءة: مالك → الملف الكامل برابط موقّع قصير العمر + علامة مائية باسم القارئ.
 * غير مالك → المعاينة فقط. لا رابط دائم أبداً.
 */
router.get('/:id/read', requireAuth, (req, res) => {
  const id = idParam(req);
  const uid = req.user!.id;
  const b = q.get<any>("SELECT * FROM books WHERE id = ? AND status = 'published'", id);
  if (!b) throw notFound('الكتاب غير موجود');
  const access = checkAccess(uid, 'book', id, req.user!.roles);
  const kind = access.allowed ? 'full' : 'preview';
  const file = q.get<{ file_id: number }>('SELECT file_id FROM book_files WHERE book_id = ? AND kind = ? ORDER BY "order" LIMIT 1', id, kind);
  if (!file) {
    if (kind === 'preview') throw new AppError('payment_required', 'لا تتوفّر معاينة — اشترِ الكتاب لقراءته', 402);
    throw new AppError('content_unavailable', 'ملف الكتاب غير متاح حالياً', 503);
  }
  const progress = q.get<any>('SELECT last_page, bookmarks FROM reading_progress WHERE user_id = ? AND book_id = ?', uid, id);
  const u = q.get<any>('SELECT u.phone, u.email, p.display_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?', uid);
  const contact = u?.phone ? `…${u.phone.slice(-4)}` : u?.email ? u.email.replace(/^(.{2}).*(@.*)$/, '$1…$2') : '';
  const link = signedUrl(file.file_id, uid);
  if (kind === 'preview') q.run('INSERT INTO analytics_events (user_id, name, props) VALUES (?,?,?)', uid, 'book_preview', JSON.stringify({ id }));
  res.json({
    kind, url: link.url, expiresAt: link.expiresAt,
    watermark: kind === 'full' ? `${u?.display_name ?? ''} ${contact} — ${config.brand.name.ar}` : null,
    lastPage: progress?.last_page ?? null, bookmarks: json<number[]>(progress?.bookmarks, []),
    previewPages: b.preview_pages,
  });
});

router.put('/:id/progress', requireAuth, validate(ReaderProgress), (req, res) => {
  const { page } = body<typeof ReaderProgress>(req);
  q.run(`INSERT INTO reading_progress (user_id, book_id, last_page, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(user_id, book_id) DO UPDATE SET last_page = excluded.last_page, updated_at = excluded.updated_at`, req.user!.id, idParam(req), page, nowIso());
  res.json({ ok: true });
});
router.post('/:id/bookmarks', requireAuth, validate(BookmarkToggle), (req, res) => {
  const { page } = body<typeof BookmarkToggle>(req);
  const id = idParam(req);
  const row = q.get<any>('SELECT bookmarks FROM reading_progress WHERE user_id = ? AND book_id = ?', req.user!.id, id);
  const set = new Set(json<number[]>(row?.bookmarks, []));
  set.has(page) ? set.delete(page) : set.add(page);
  const list = [...set].sort((a, b) => a - b);
  q.run(`INSERT INTO reading_progress (user_id, book_id, bookmarks, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(user_id, book_id) DO UPDATE SET bookmarks = excluded.bookmarks, updated_at = excluded.updated_at`, req.user!.id, id, JSON.stringify(list), nowIso());
  res.json({ bookmarks: list });
});

/* ---------- نشر المعلّم ---------- */
const upsertBook = (id: number | null, authorId: number, b: z.infer<typeof BookUpsert>) => db.transaction(() => {
  const args = [b.title, b.type, b.subjectId, b.gradeId, b.semesterId, b.description, JSON.stringify(b.learnPoints), JSON.stringify(b.tags), money(b.price), b.pages, b.edition, b.version, b.language, b.level, b.previewPages];
  let bookId = id;
  if (id) {
    q.run(`UPDATE books SET title=?, type=?, subject_id=?, grade_id=?, semester_id=?, description=?, learn_points=?, tags=?, price=?, pages=?, edition=?, version=?, language=?, level=?, preview_pages=?, updated_at=?,
           status = CASE WHEN status IN ('published','approved') THEN 'pending_review' ELSE status END WHERE id = ?`, ...args, nowIso(), id);
  } else {
    const info = q.run(`INSERT INTO books (title, type, subject_id, grade_id, semester_id, description, learn_points, tags, price, pages, edition, version, language, level, preview_pages, author_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...args, authorId);
    bookId = Number(info.lastInsertRowid);
  }
  q.run('DELETE FROM book_toc WHERE book_id = ?', bookId);
  b.toc.forEach((t, i) => q.run('INSERT INTO book_toc (book_id, title, page, "order") VALUES (?,?,?,?)', bookId, t.title, t.page, i));
  return q.get<any>('SELECT * FROM books WHERE id = ?', bookId);
})();

router.post('/', requireVerifiedTeacher, validate(BookUpsert), (req, res) => {
  const b = upsertBook(null, req.user!.id, body<typeof BookUpsert>(req));
  res.status(201).json({ ...bookCard(b, { userId: req.user!.id }), status: b.status });
});
const ownBook = (req: any) => {
  const b = q.get<any>('SELECT * FROM books WHERE id = ?', idParam(req));
  if (!b) throw notFound();
  if (b.author_id !== req.user!.id && !hasRole(req.user, 'admin')) throw forbidden();
  return b;
};
router.patch('/:id', requireVerifiedTeacher, validate(BookUpsert), (req, res) => {
  const b = upsertBook(ownBook(req).id, req.user!.id, body<typeof BookUpsert>(req));
  res.json({ ...bookCard(b, { userId: req.user!.id }), status: b.status });
});

/** رفع ملفات الكتاب: full / preview / sample_page (خاصة) أو cover (عامة) — غلاف صغير وملف كتاب أكبر */
const KINDS = ['cover', 'full', 'preview', 'sample_page'];
const kindOf = (req: Request) => String(req.query.kind ?? '');
/** النوع يُحسم من الاستعلام وحده وقبل قراءة أي بايت: مع kind في الجسم كان غلافٌ عام يمرّ بحدّ الكتاب (٦٠ م.ب) */
const uploadBookFile = (req: Request, res: Response, next: NextFunction) => {
  const kind = kindOf(req);
  if (!KINDS.includes(kind)) return next(badRequest('نوع الملف غير معروف'));
  return upload(kind === 'cover' ? 8 : 60)(req, res, next);
};
router.post('/:id/files', requireVerifiedTeacher, uploadBookFile, asyncHandler(async (req, res) => {
  const b = ownBook(req);
  const kind = kindOf(req);
  if (!req.file) throw badRequest('لم يُرفق ملف');
  if (kind === 'cover') {
    // SVG «صورة» أيضاً، لكنه يُخدَم من نطاق التطبيق فينفّذ سكربتاً على جلسة من يفتح صفحة الكتاب
    if (!RASTER_IMAGE.test(req.file.mimetype)) throw badRequest('الغلاف يجب أن يكون صورة');
    const f = storeUpload(req.file, { ownerId: req.user!.id, purpose: 'cover', visibility: 'public' });
    q.run('UPDATE books SET cover_file_id = ?, updated_at = ? WHERE id = ?', f.id, nowIso(), b.id);
    deleteFile(b.cover_file_id); // الغلاف المستبدَل لا مرجع له بعد الآن
    return res.status(201).json({ fileId: f.id, url: publicUrl(f.id) });
  }
  const okMime = kind === 'sample_page' ? new RegExp(`(${RASTER_IMAGE.source})|^application/pdf$`) : /^application\/pdf$/;
  if (!okMime.test(req.file.mimetype)) throw badRequest('الملف يجب أن يكون PDF');
  const f = storeUpload(req.file, { ownerId: req.user!.id, purpose: 'book', visibility: 'private' });
  const replaced = kind === 'sample_page' ? null : q.val<number>('SELECT file_id FROM book_files WHERE book_id = ? AND kind = ?', b.id, kind);
  if (kind !== 'sample_page') q.run('DELETE FROM book_files WHERE book_id = ? AND kind = ?', b.id, kind);
  const order = (q.val<number>('SELECT COALESCE(MAX("order"),0) FROM book_files WHERE book_id = ?', b.id) ?? 0) + 1;
  q.run('INSERT INTO book_files (book_id, kind, file_id, "order") VALUES (?,?,?,?)', b.id, kind, f.id, order);
  q.run('UPDATE books SET updated_at = ? WHERE id = ?', nowIso(), b.id);
  deleteFile(replaced); // نسخة الكتاب السابقة كانت تبقى على القرص للأبد
  res.status(201).json({ fileId: f.id, kind });
}));

/** إرسال للمراجعة — يُنشَر بعد موافقة المراجع */
router.post('/:id/submit', requireVerifiedTeacher, (req, res) => {
  const b = ownBook(req);
  if (!q.get("SELECT 1 FROM book_files WHERE book_id = ? AND kind = 'full'", b.id)) throw badRequest('ارفع ملف الكتاب الكامل أولاً');
  if (!['draft', 'rejected', 'pending_review'].includes(b.status)) throw badRequest('الكتاب ليس في حالة تسمح بالإرسال');
  q.run("UPDATE books SET status = 'pending_review', reject_reason = NULL, updated_at = ? WHERE id = ?", nowIso(), b.id);
  notifyStaff(['content_reviewer', 'admin'], { type: 'system', title: 'كتاب جديد بانتظار المراجعة', body: b.title, data: { bookId: b.id } });
  res.json({ ok: true, status: 'pending_review' });
});

export default router;
