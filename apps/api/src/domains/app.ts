import { Router } from 'express';
import fs from 'node:fs';
import QRCode from 'qrcode';
import { config } from '../config.ts';
import { asyncHandler } from '../lib/errors.ts';

/**
 * تحميل تطبيق أندرويد: معلومات الملف المخدوم من هذا الخادم (إن وُجد) ورابط GitHub الثابت، ورمز QR لصفحة التحميل.
 * الملف نفسه يُخدَم من /manassah.apk في index.ts.
 */
const router = Router();

export function apkInfo(): { size: number; updatedAt: string } | null {
  try { const st = fs.statSync(config.app.apkPath); return st.isFile() ? { size: st.size, updatedAt: st.mtime.toISOString() } : null; } catch { return null; }
}

router.get('/app', (_req, res) => {
  const info = apkInfo();
  res.json({
    available: !!info,
    url: info ? `${config.publicUrl}/manassah.apk` : null,
    githubUrl: config.app.githubApkUrl,
    size: info?.size ?? null,
    versionCode: config.app.versionCode,
    updatedAt: info?.updatedAt ?? null,
    qrUrl: `${config.publicUrl}/api/app/qr.svg`,
  });
});

/** رمز QR يفتح صفحة التحميل على هذا الخادم — يُمسح بكاميرا الهاتف من شاشة الحاسوب */
router.get('/app/qr.svg', asyncHandler(async (_req, res) => {
  const svg = await QRCode.toString(`${config.publicUrl}/get-app`, { type: 'svg', margin: 1, width: 240, color: { dark: '#1f2937', light: '#ffffff' } });
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
}));

export default router;
