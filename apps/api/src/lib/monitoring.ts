import { config } from '../config.ts';

/**
 * المراقبة: عند ضبط SENTRY_DSN يُحمَّل @sentry/node ديناميكياً (لا يُحمَّل أصلاً بدونه) وتُلتقط أخطاء 5xx
 * من errorHandler والرفض غير المعالج في العملية. بلا DSN كل الدوال هنا لا تفعل شيئاً.
 */
type Client = { captureException: (err: unknown) => unknown };
let client: Client | null = null;
let hooked = false;

export const monitoringEnabled = (): boolean => client !== null;

export function captureException(err: unknown): void {
  try { client?.captureException(err); } catch { /* المراقبة لا تُسقط الطلب أبداً */ }
}

/** يُستدعى مرة عند الإقلاع (start) — يعيد true عند تفعيل المراقبة */
export async function initMonitoring(): Promise<boolean> {
  if (!hooked) {
    hooked = true;
    process.on('unhandledRejection', (reason) => { console.error('[unhandledRejection]', reason); captureException(reason); });
  }
  const { sentryDsn, tracesSampleRate } = config.monitoring;
  if (!sentryDsn) return false;
  try {
    const sentry = await import('@sentry/node');
    sentry.init({ dsn: sentryDsn, tracesSampleRate, environment: config.env });
    client = sentry;
    console.log('[monitoring] sentry enabled');
    return true;
  } catch (err) {
    console.error('[monitoring] sentry init failed', (err as Error)?.message);
    return false;
  }
}
