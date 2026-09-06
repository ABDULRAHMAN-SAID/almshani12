import express from 'express';
import http from 'node:http';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import config, { ROOT } from './config.js';
import { migrate, q } from './db/database.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { setupRealtime } from './realtime/live.js';

import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import courseRoutes from './routes/courses.js';
import liveRoutes from './routes/live.js';
import summaryRoutes from './routes/summaries.js';
import commerceRoutes from './routes/commerce.js';
import learningRoutes from './routes/learning.js';
import meRoutes from './routes/me.js';
import instructorRoutes from './routes/instructor.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/uploads.js';

migrate();

const app = express();
const server = http.createServer(app);

if (config.security.trustProxy) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // كل الأصول محلية؛ الاستثناء الوحيد خطوط جوجل
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      mediaSrc: ["'self'", 'https:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
      frameSrc: ["'self'", 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: config.security.corsOrigins.length ? config.security.corsOrigins : true,
  credentials: true,
}));
app.use(compression());
app.use(cookieParser());
// نحتفظ بالجسم الخام للتحقّق من توقيع webhook
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

if (config.rateLimit.enabled) {
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    max: config.rateLimit.apiPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'طلبات كثيرة جداً، أعد المحاولة بعد قليل' } },
  }));
}

/* ----------------------------- المسارات ----------------------------- */
app.get('/api/health', (_req, res) => res.json({
  ok: true, name: config.platform.name, env: config.env, time: new Date().toISOString(),
}));

app.use('/api/auth', authRoutes);
app.use('/api', publicRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/summaries', summaryRoutes);
app.use('/api', commerceRoutes);
app.use('/api', learningRoutes);
app.use('/api/me', meRoutes);
app.use('/api/instructor', instructorRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);

/* ----------------------------- الملفات الثابتة ----------------------------- */
app.use('/uploads', express.static(config.uploads.dir, { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: config.env === 'production' ? '1h' : 0 }));
app.use('/legacy', express.static(path.join(ROOT, 'legacy')));

app.use(notFoundHandler);
// تطبيق صفحة واحدة: أي مسار غير معروف يعيد الواجهة
app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.use(errorHandler);

/* ----------------------------- التشغيل ----------------------------- */
const io = setupRealtime(server);
app.set('io', io);

/** مهمة دورية: إنهاء الحصص المنتهية وتذكير من قرب موعدهم. */
function scheduledTasks() {
  try {
    q.run(
      `UPDATE live_sessions SET status = 'ended', ended_at = datetime('now')
        WHERE status IN ('scheduled','live')
          AND datetime(starts_at, '+' || (duration_minutes + 30) || ' minutes') < datetime('now')`);
    q.run("UPDATE subscriptions SET status = 'expired' WHERE status = 'active' AND ends_at < datetime('now')");
  } catch (err) {
    console.error('[cron]', err.message);
  }
}
setInterval(scheduledTasks, 5 * 60 * 1000).unref();
scheduledTasks();

if (process.env.NODE_ENV !== 'test') {
  server.listen(config.port, config.host, () => {
    console.log(`\n🎓  ${config.platform.name} — يعمل الآن`);
    console.log(`    ${config.publicUrl}`);
    console.log(`    البيئة: ${config.env} | العملة: ${config.money.currency} | بوابات الدفع: ${config.payments.providers.join(', ')}\n`);
  });
}

export { app, server, io };
