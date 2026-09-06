import express from 'express';
import { db, q } from '../db/database.js';
import { asyncHandler, AppError, notFound, forbidden, paymentRequired } from '../middleware/error.js';
import { validate, z, arabicText, priceField } from '../middleware/validate.js';
import { attachUser, requireAuth, requireInstructor } from '../middleware/auth.js';
import { paginate, pageMeta, uniqueSlug, json, toJson, nowIso } from '../utils/helpers.js';
import { checkAccess, grantAccess } from '../services/access.js';
import { notifyAdmins } from '../services/notifications.js';

const router = express.Router();

const summaryCard = `
  s.id, s.title, s.slug, s.book_title, s.book_author, s.cover, s.description, s.price, s.discount_price,
  s.reading_minutes, s.rating_avg, s.rating_count, s.sales_count, s.featured, s.status, s.published_at,
  s.author_id, s.pdf_url IS NOT NULL AS has_pdf, s.audio_url IS NOT NULL AS has_audio,
  u.name AS author_name, u.avatar AS author_avatar, cat.name AS category_name, cat.slug AS category_slug`;

/* ---------------------- قائمة الملخّصات ---------------------- */
router.get('/', attachUser, asyncHandler(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const { search, category, sort = 'newest', free, max_minutes, format } = req.query;

  const where = ["s.status = 'published'"];
  const params = [];

  if (search) {
    where.push('(s.title LIKE ? OR s.book_title LIKE ? OR s.book_author LIKE ? OR s.description LIKE ?)');
    const t = `%${search}%`; params.push(t, t, t, t);
  }
  if (category) { where.push('cat.slug = ?'); params.push(category); }
  if (free === 'true') where.push('COALESCE(s.discount_price, s.price) = 0');
  if (max_minutes) { where.push('s.reading_minutes <= ?'); params.push(Number(max_minutes)); }
  if (format === 'audio') where.push('s.audio_url IS NOT NULL');
  if (format === 'pdf') where.push('s.pdf_url IS NOT NULL');

  const orderBy = {
    newest: 's.published_at DESC, s.id DESC',
    popular: 's.sales_count DESC',
    rating: 's.rating_avg DESC, s.rating_count DESC',
    price_asc: 'COALESCE(s.discount_price, s.price) ASC',
    price_desc: 'COALESCE(s.discount_price, s.price) DESC',
    shortest: 's.reading_minutes ASC',
  }[sort] || 's.published_at DESC';

  const whereSql = where.join(' AND ');
  const total = q.val(
    `SELECT COUNT(*) AS c FROM summaries s LEFT JOIN categories cat ON cat.id = s.category_id WHERE ${whereSql}`, ...params);
  const rows = q.all(
    `SELECT ${summaryCard} FROM summaries s
       JOIN users u ON u.id = s.author_id
       LEFT JOIN categories cat ON cat.id = s.category_id
      WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, ...params, limit, offset);

  res.json({ data: rows, meta: pageMeta(total, { page, limit }) });
}));

/* ---------------------- تفاصيل ملخّص (المحتوى الكامل محميّ) ---------------------- */
router.get('/:slug', attachUser, asyncHandler(async (req, res) => {
  const summary = q.get(
    `SELECT s.*, u.name AS author_name, u.avatar AS author_avatar, u.bio AS author_bio,
            cat.name AS category_name, cat.slug AS category_slug
       FROM summaries s JOIN users u ON u.id = s.author_id
       LEFT JOIN categories cat ON cat.id = s.category_id
      WHERE s.slug = ? OR s.id = ?`, req.params.slug, Number(req.params.slug) || 0);
  if (!summary) throw notFound('الملخّص غير موجود');

  const isOwner = req.user && (req.user.id === summary.author_id || req.user.role === 'admin');
  if (summary.status !== 'published' && !isOwner) throw notFound('الملخّص غير متاح');

  const access = checkAccess(req.user?.id, 'summary', summary.id, { user: req.user });

  // المحتوى الكامل والملفات لا تُرسَل إلا لمن يملك الصلاحية
  const payload = {
    ...summary,
    key_ideas: json(summary.key_ideas, []),
    content: access.allowed ? summary.content : null,
    pdf_url: access.allowed ? summary.pdf_url : null,
    audio_url: access.allowed ? summary.audio_url : null,
    has_pdf: !!summary.pdf_url,
    has_audio: !!summary.audio_url,
  };

  res.json({
    summary: payload, access,
    related: q.all(
      `SELECT ${summaryCard} FROM summaries s JOIN users u ON u.id = s.author_id
         LEFT JOIN categories cat ON cat.id = s.category_id
        WHERE s.status='published' AND s.id <> ? AND (s.category_id = ? OR s.author_id = ?)
        ORDER BY s.sales_count DESC LIMIT 4`, summary.id, summary.category_id, summary.author_id),
    reviews: q.all(
      `SELECT r.*, u.name AS user_name, u.avatar AS user_avatar FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.item_type='summary' AND r.item_id = ? AND r.status='published' ORDER BY r.id DESC LIMIT 20`, summary.id),
    notes: req.user ? q.all('SELECT * FROM notes WHERE user_id = ? AND summary_id = ? ORDER BY id DESC', req.user.id, summary.id) : [],
  });
}));

/* ---------------------- قارئ الملخّص (تحقّق صارم) ---------------------- */
router.get('/:id/read', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const summary = q.get('SELECT * FROM summaries WHERE id = ?', Number(req.params.id));
  if (!summary) throw notFound('الملخّص غير موجود');
  const access = checkAccess(req.user.id, 'summary', summary.id, { user: req.user });
  if (!access.allowed) throw paymentRequired('اشترِ هذا الملخّص للاطلاع على محتواه كاملاً');

  res.json({
    id: summary.id, title: summary.title, book_title: summary.book_title, book_author: summary.book_author,
    content: summary.content, key_ideas: json(summary.key_ideas, []),
    pdf_url: summary.pdf_url, audio_url: summary.audio_url,
    reading_minutes: summary.reading_minutes, access,
  });
}));

/* ---------------------- الحصول على ملخّص مجاني ---------------------- */
router.post('/:id/claim', attachUser, requireAuth, asyncHandler(async (req, res) => {
  const summary = q.get('SELECT * FROM summaries WHERE id = ? AND status = ?', Number(req.params.id), 'published');
  if (!summary) throw notFound('الملخّص غير موجود');
  const price = summary.discount_price ?? summary.price;
  if (price > 0) {
    const access = checkAccess(req.user.id, 'summary', summary.id, { user: req.user });
    if (!access.allowed) throw paymentRequired('هذا الملخّص مدفوع — أضفه للسلة');
  }
  grantAccess(req.user.id, 'summary', summary.id, { source: price > 0 ? 'subscription' : 'free' });
  res.json({ ok: true });
}));

/* ---------------------- ملاحظات على الملخّص ---------------------- */
router.post('/:id/notes', attachUser, requireAuth, validate(z.object({ body: arabicText(1, 2000) })), asyncHandler(async (req, res) => {
  const access = checkAccess(req.user.id, 'summary', Number(req.params.id), { user: req.user });
  if (!access.allowed) throw paymentRequired();
  const info = q.run('INSERT INTO notes (user_id, summary_id, body) VALUES (?,?,?)',
    req.user.id, Number(req.params.id), req.body.body);
  res.status(201).json(q.get('SELECT * FROM notes WHERE id = ?', info.lastInsertRowid));
}));

/* ======================= إدارة الملخّصات (المُعِدّ) ======================= */
const summarySchema = z.object({
  title: arabicText(3, 200),
  book_title: arabicText(2, 200),
  book_author: arabicText(2, 120),
  category_id: z.coerce.number().int().positive().optional().nullable(),
  cover: z.string().trim().max(500).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  price: priceField.default(0),
  discount_price: priceField.optional().nullable(),
  reading_minutes: z.coerce.number().int().min(1).max(600).default(15),
  key_ideas: z.array(z.string().trim().max(300)).max(30).optional(),
  preview_content: z.string().max(10000).optional().nullable(),
  content: z.string().max(200000).optional().nullable(),
  pdf_url: z.string().trim().max(500).optional().nullable(),
  audio_url: z.string().trim().max(500).optional().nullable(),
});

function assertSummaryOwner(id, user) {
  const summary = q.get('SELECT * FROM summaries WHERE id = ?', id);
  if (!summary) throw notFound('الملخّص غير موجود');
  if (user.role !== 'admin' && summary.author_id !== user.id) throw forbidden('هذا ليس ملخّصك');
  return summary;
}

router.post('/', attachUser, requireInstructor, validate(summarySchema), asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.discount_price != null && b.discount_price > b.price) {
    throw new AppError('سعر العرض يجب أن يكون أقل من السعر الأصلي', 400, 'invalid_discount');
  }
  const info = q.run(
    `INSERT INTO summaries (author_id, category_id, title, slug, book_title, book_author, cover, description,
                            price, discount_price, reading_minutes, key_ideas, preview_content, content, pdf_url, audio_url, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`,
    req.user.id, b.category_id ?? null, b.title, uniqueSlug(db, 'summaries', b.title), b.book_title, b.book_author,
    b.cover ?? null, b.description ?? null, b.price, b.discount_price ?? null, b.reading_minutes,
    toJson(b.key_ideas ?? []), b.preview_content ?? null, b.content ?? null, b.pdf_url ?? null, b.audio_url ?? null);
  res.status(201).json(q.get('SELECT * FROM summaries WHERE id = ?', info.lastInsertRowid));
}));

router.patch('/:id', attachUser, requireInstructor, validate(summarySchema.partial()), asyncHandler(async (req, res) => {
  const summary = assertSummaryOwner(Number(req.params.id), req.user);
  const b = { ...req.body };
  if (b.key_ideas) b.key_ideas = toJson(b.key_ideas);
  const fields = Object.entries(b).filter(([, v]) => v !== undefined);
  if (fields.length) {
    q.run(`UPDATE summaries SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...fields.map(([, v]) => v), nowIso(), summary.id);
  }
  res.json(q.get('SELECT * FROM summaries WHERE id = ?', summary.id));
}));

router.post('/:id/submit', attachUser, requireInstructor, asyncHandler(async (req, res) => {
  const summary = assertSummaryOwner(Number(req.params.id), req.user);
  if (!summary.content || summary.content.trim().length < 200) {
    throw new AppError('محتوى الملخّص قصير جداً — أضف ٢٠٠ حرف على الأقل', 400, 'content_too_short');
  }
  if (!summary.preview_content) {
    throw new AppError('أضف مقتطفاً مجانياً يشجّع القارئ على الشراء', 400, 'missing_preview');
  }
  q.run("UPDATE summaries SET status = 'pending', updated_at = ? WHERE id = ?", nowIso(), summary.id);
  notifyAdmins({ type: 'summary_review', title: 'ملخّص بانتظار المراجعة', body: summary.title, link: '#/admin/summaries' });
  res.json({ ok: true, status: 'pending' });
}));

router.delete('/:id', attachUser, requireInstructor, asyncHandler(async (req, res) => {
  const summary = assertSummaryOwner(Number(req.params.id), req.user);
  const sold = q.val("SELECT COUNT(*) AS c FROM entitlements WHERE item_type='summary' AND item_id = ? AND source='purchase'", summary.id);
  if (sold > 0) {
    q.run("UPDATE summaries SET status = 'archived' WHERE id = ?", summary.id);
    return res.json({ ok: true, archived: true, message: 'تمت الأرشفة (يوجد مشترون)' });
  }
  q.run('DELETE FROM summaries WHERE id = ?', summary.id);
  res.json({ ok: true, deleted: true });
}));

export default router;
