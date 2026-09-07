import { useUi } from '@/state/ui';
import { signOut } from '@/lib/session';

/**
 * سجلّ الخادم التجريبي: ملف JSON عام يكتبه تشغيل live-server على GitHub بعنوان النفق الحالي
 * (trycloudflare — يتغيّر مع كل تشغيل ويموت بعد ٥ ساعات). التطبيق يقرأه ليتّصل بالعنوان الصحيح دون كتابته يدوياً.
 * الجلب هنا مباشر بـ fetch لا يمرّ بعميل الـ API — كي لا يستدعي الاسترداد التلقائي في العميل نفسه.
 */
export const REGISTRY_URL = process.env.EXPO_PUBLIC_REGISTRY_URL
  || 'https://raw.githubusercontent.com/ABDULRAHMAN-SAID/almshani12/claude/digital-education-platform-1w1zvq/.live/server.json';

/** شكل السجلّ كما يكتبه التشغيل */
export interface LiveServer {
  status: 'up' | 'down';
  url: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  runUrl: string | null;
}

export type ConnectResult = { ok: true; url: string } | { ok: false; reason: 'down' | 'unreachable' | 'registry' };

const TIMEOUT_MS = 8000;

/** جلب بمهلة ٨ ثوانٍ — الشبكات البطيئة أو النفق الميت لا يجب أن تعلّق الزر بلا نهاية */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); } finally { clearTimeout(id); }
}

/** يقرأ السجلّ متجاوزاً أي تخزين مؤقّت (raw.githubusercontent يخزّن دقائق؛ الطابع الزمني و no-store يكسرانه) — يرمي عند فشل الجلب أو التحليل */
export async function fetchLiveServer(): Promise<LiveServer> {
  const r = await fetchWithTimeout(`${REGISTRY_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as Partial<LiveServer> | null;
  if (!j || typeof j !== 'object') throw new Error('bad registry');
  return {
    status: j.status === 'up' ? 'up' : 'down',
    url: typeof j.url === 'string' && /^https?:\/\//.test(j.url) ? j.url.replace(/\/+$/, '') : null,
    startedAt: typeof j.startedAt === 'string' ? j.startedAt : null,
    expiresAt: typeof j.expiresAt === 'string' ? j.expiresAt : null,
    runUrl: typeof j.runUrl === 'string' ? j.runUrl : null,
  };
}

/** يطرق /api/health بالعنوان الكامل ويعيد اسم الخادم وبيئته إن ردّ — لا يرمي أبداً */
export async function probeServer(url: string): Promise<{ ok: boolean; name?: string; env?: string }> {
  try {
    const r = await fetchWithTimeout(`${url.replace(/\/+$/, '')}/api/health`);
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; name?: string; env?: string };
    return r.ok && j?.ok ? { ok: true, name: j.name, env: j.env } : { ok: false };
  } catch { return { ok: false }; }
}

/**
 * الاتصال بالخادم التجريبي: يقرأ السجلّ → إن كان متوقفاً أو بلا عنوان فـ down → يطرق /api/health → إن لم يردّ فـ unreachable
 * → يحفظ العنوان ثم يخرج (الخروج يعيد إلى الترحيب ليُسجَّل الدخول على الخادم الجديد؛ التخطيط الجذري يخرج أيضاً عند تغيّر الخادم والاستدعاءان يُدمجان).
 */
export async function connectToLiveServer(): Promise<ConnectResult> {
  let live: LiveServer;
  try { live = await fetchLiveServer(); } catch { return { ok: false, reason: 'registry' }; }
  if (live.status !== 'up' || !live.url) return { ok: false, reason: 'down' };
  if (!(await probeServer(live.url)).ok) return { ok: false, reason: 'unreachable' };
  useUi.getState().setServerUrl(live.url);
  await signOut();
  return { ok: true, url: live.url };
}
