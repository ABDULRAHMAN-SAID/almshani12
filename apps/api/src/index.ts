import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config.ts';
import { migrate, q } from './db/index.ts';
import { SCHEMA_VERSION } from './db/migrations.ts';
import { attachUser } from './lib/auth.ts';
import { notFoundHandler, errorHandler, AppError } from './lib/errors.ts';
import { verifySignedAccess, getFile, absolutePath } from './services/storage.ts';
import { expirePendingBookings, closeFinishedBookings } from './services/bookings.ts';
import { expirePendingOrders } from './services/checkout.ts';
import { releaseEarnings } from './services/earnings.ts';
import { sendLessonReminders } from './services/reminders.ts';
import { attachRealtime } from './realtime/index.ts';
import { bootstrapIfEmpty } from './db/seed.ts';
import { otpMethods } from './services/otp.ts';
import { summary as integrationsSummary } from './services/integrations.ts';
import { availableProviders } from './services/payments.ts';
import { startBackupScheduler } from './services/backups.ts';
import { initMonitoring } from './lib/monitoring.ts';
import auth from './domains/auth.ts';
import users from './domains/users.ts';
import pushRouter from './domains/push.ts';
import catalog from './domains/catalog.ts';
import books from './domains/books.ts';
import courses from './domains/courses.ts';
import { publicRouter as teachers, selfRouter as teacherSelf } from './domains/teachers.ts';
import bookings from './domains/bookings.ts';
import { cartRouter, checkoutRouter, ordersRouter, paymentsRouter, mockPayPage } from './domains/orders.ts';
import home from './domains/home.ts';
import messages from './domains/messages.ts';
import admin from './domains/admin.ts';

export function createApp() {
  migrate();
  const app = express();
  app.disable('x-powered-by');
  if (config.security.trustProxy) app.set('trust proxy', 1);
  // COOP «same-origin-allow-popups»: نوافذ Google/Apple المنبثقة على الويب تعيد الرمز عبر postMessage — «same-origin» الافتراضي يقطعها
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, contentSecurityPolicy: false }));
  app.use(cors({
    origin: config.security.corsOrigins.length ? config.security.corsOrigins : true, credentials: true,
    // X-Learner-Id: المتعلّم النشط في العميل (انظر services/learners.ts)
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'X-Learner-Id'],
  }));
  app.use(compression());
  // ردود بوابات الدفع تحتاج الجسم الخام للتحقّق من التوقيع — تُركَّب قبل json()
  app.use('/api/payments', paymentsRouter);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(rateLimit({
    windowMs: 60_000, limit: config.rateLimit.apiPerMinute, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => !config.rateLimit.enabled,
    handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message: 'محاولات كثيرة. انتظر قليلاً ثم حاول.' } }),
  }));
  app.use(attachUser);

  app.get('/api/health', (_req, res) => res.json({ ok: true, name: config.brand.name.ar, env: config.env, time: new Date().toISOString(), schemaVersion: SCHEMA_VERSION, otp: otpMethods(), integrations: integrationsSummary() }));
  app.get('/api/config', (_req, res) => res.json({
    brand: config.brand, paymentProviders: config.payments.providers, roomProvider: config.rooms.provider,
    devOtp: !!config.otp.fixedCode, mockPayments: config.env !== 'production' && config.payments.providers.includes('mock'),
    // ما يحتاجه التطبيق ليُظهر أزرار الدخول الاجتماعي والإشعارات ووسائل الدفع الفعلية — معرّفات عامة فقط
    auth: { google: config.auth.google.clientIds[0] ?? null, apple: { servicesId: config.auth.apple.servicesId || null, native: config.auth.apple.clientIds.length > 0 } },
    push: { web: config.push.vapid.publicKey || null },
    payments: { providers: availableProviders(), thawaniMode: availableProviders().includes('thawani') ? config.payments.thawani.mode : null },
  }));

  /* ---------- الملفات: عامة بلا توقيع، وخاصة بتوقيع قصير العمر ---------- */
  app.get('/api/files/public/:id', (req, res, next) => {
    const f = getFile(Number(req.params.id));
    if (!f || f.visibility !== 'public') return next(new AppError('not_found', 'الملف غير موجود', 404));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type(f.mime).sendFile(absolutePath(f));
  });
  app.get('/api/files/:id', (req, res, next) => {
    try {
      const f = verifySignedAccess(Number(req.params.id), Number(req.query.u), Number(req.query.e), String(req.query.s ?? ''));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.original_name ?? `file-${f.id}`)}"`);
      res.type(f.mime).sendFile(absolutePath(f)); // يدعم Range للفيديو والصفحات
    } catch (err) { next(err); }
  });

  // عارض PDF مستضاف ذاتياً — لا اعتماد على CDN خارجي ولا تسريب لروابط الملفات
  const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  app.use('/static/pdfjs', express.static(path.join(pdfjsDir, 'build'), { maxAge: '7d', immutable: true }));

  app.use('/api/auth', auth);
  app.use('/api', users);
  app.use('/api', pushRouter);
  app.use('/api/catalog', catalog);
  app.use('/api/books', books);
  app.use('/api/courses', courses);
  app.use('/api/teachers', teachers);
  app.use('/api/teacher', teacherSelf);
  app.use('/api/bookings', bookings);
  app.use('/api/cart', cartRouter);
  app.use('/api/checkout', checkoutRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/home', home);
  app.use('/api/conversations', messages);
  app.use('/api/admin', admin);
  app.use(mockPayPage);

  // لوحة الإدارة المبنية (إن وُجدت) تُخدَم من /admin
  const adminDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../admin/dist');
  if (fs.existsSync(adminDist)) {
    app.use('/admin', express.static(adminDist));
    app.get('/admin/*', (_req, res) => res.sendFile(path.join(adminDist, 'index.html')));
  }
  // تطبيق الويب المبنيّ (npm run web:build) يُخدَم من الجذر — خادم واحد للواجهة والـ API والغرف
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../mobile/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: 'index.html', maxAge: '1h' }));
    app.get(/^(?!\/api\/|\/admin|\/static\/|\/pay\/mock\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  const server = http.createServer(app);
  const io = attachRealtime(server);
  return { app, server, io };
}

/** المهام الدورية: مهل الدفع، إغلاق الحصص، تحرير الأرباح، التذكيرات */
export function runMaintenance() {
  try {
    expirePendingBookings(); expirePendingOrders(); closeFinishedBookings(); releaseEarnings(); sendLessonReminders();
  } catch (err) { console.error('[maintenance]', err); }
}

export function start() {
  const { server } = createApp();
  const boot = bootstrapIfEmpty();
  if (boot.seeded !== 'none') console.log(`[bootstrap] ${boot.seeded === 'demo' ? 'بيانات العرض' : 'المنهج'}${boot.admin ? ` + مدير ${boot.admin}` : ''}`);
  server.listen(config.port, config.host, () => {
    console.log(`✔ ${config.brand.name.ar} API — ${config.publicUrl}  (${config.env})`);
    console.log(`  users: ${q.val<number>('SELECT COUNT(*) FROM users')}  providers: ${config.payments.providers.join(',')}  rooms: ${config.rooms.provider}`);
  });
  void initMonitoring();
  startBackupScheduler();
  runMaintenance();
  const timer = setInterval(runMaintenance, 60_000);
  timer.unref();
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) start();
