import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';
import { q } from '../db/database.js';
import { asyncHandler, AppError } from '../middleware/error.js';
import { attachUser, requireAuth } from '../middleware/auth.js';

const router = express.Router();

const ALLOWED = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  video: ['video/mp4', 'video/webm', 'video/ogg'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'],
  doc: ['application/pdf'],
};
const ALL_MIMES = Object.values(ALLOWED).flat();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploads.dir),
  filename: (_req, file, cb) => {
    // اسم عشوائي + امتداد مُطهَّر: يمنع الكتابة خارج المجلد أو تنفيذ اسم خبيث
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxSizeMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALL_MIMES.includes(file.mimetype)) {
      return cb(new AppError(`نوع الملف غير مدعوم (${file.mimetype})`, 400, 'unsupported_type'));
    }
    cb(null, true);
  },
});

router.post('/', attachUser, requireAuth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(`حجم الملف يتجاوز ${config.uploads.maxSizeMb} ميغابايت`, 413, 'file_too_large'));
      }
      return next(err);
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('لم يُرفَق أي ملف', 400, 'no_file');

  const url = `/uploads/${req.file.filename}`;
  q.run('INSERT INTO files (user_id, filename, path, mime, size, purpose) VALUES (?,?,?,?,?,?)',
    req.user.id, req.file.originalname.slice(0, 200), url, req.file.mimetype, req.file.size,
    String(req.body.purpose || 'general').slice(0, 40));

  res.status(201).json({ url, mime: req.file.mimetype, size: req.file.size });
}));

router.get('/mine', attachUser, requireAuth, asyncHandler(async (req, res) => {
  res.json({ data: q.all('SELECT * FROM files WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id) });
}));

export default router;
