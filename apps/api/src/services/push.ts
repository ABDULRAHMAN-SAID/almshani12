import webpush from 'web-push';
import { config } from '../config.ts';
import { q, nowIso } from '../db/index.ts';

/**
 * الإشعارات الفورية: المتصفح (Web Push بمفاتيح VAPID) وتطبيق Expo (خدمة Expo Push).
 * الأجهزة في push_devices؛ الجهاز الذي يرفضه المزوّد نهائياً (404/410، أو 401/403 = اشتراك بمفاتيح VAPID قديمة، أو DeviceNotRegistered) يُحذف.
 * لا يرمي للمستدعي أبداً — يُسجَّل العدّ فقط. الاختبارات تستبدل `pushTransports.web/expo`.
 */
export interface PushPayload { title: string; body?: string | null; data?: Record<string, unknown> | null; url?: string | null }
export interface WebSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
export interface ExpoMessage { to: string; title: string; body?: string; data?: Record<string, unknown>; sound: 'default' }
export interface ExpoTicket { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }
type DeviceRow = { id: number; kind: 'expo' | 'web'; token: string; auth: string | null; p256dh: string | null };

const EXPO_BATCH = 100;
const TIMEOUT_MS = 10_000;

export const pushTransports = {
  /** يرمي WebPushError (statusCode) عند الرفض — 404/410 تعني اشتراكاً منتهياً */
  web: async (sub: WebSubscription, payload: string): Promise<void> => {
    const { vapid, subject } = config.push;
    await webpush.sendNotification(sub, payload, { vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 3600, timeout: TIMEOUT_MS });
  },
  /** دفعة ≤ ١٠٠ رسالة → تذاكر بنفس الترتيب */
  expo: async (messages: ExpoMessage[]): Promise<ExpoTicket[]> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(config.push.expoUrl, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(config.push.expoAccessToken ? { Authorization: `Bearer ${config.push.expoAccessToken}` } : {}) },
        body: JSON.stringify(messages),
      });
      const json = await res.json().catch(() => null) as { data?: ExpoTicket[] } | null;
      if (!res.ok || !Array.isArray(json?.data)) throw new Error(`expo push HTTP ${res.status}`);
      return json.data;
    } finally { clearTimeout(timer); }
  },
};

const statusOf = (err: unknown): number => Number((err as { statusCode?: number })?.statusCode ?? 0);
const removeDevice = (id: number) => q.run('DELETE FROM push_devices WHERE id = ?', id);

/** يرسل لكل أجهزة المستخدم النشط؛ يعيد عدد ما أُرسل وما حُذف */
export async function sendPush(userId: number, payload: PushPayload): Promise<{ sent: number; removed: number }> {
  const out = { sent: 0, removed: 0 };
  try {
    if (!userId || !payload?.title) return out;
    const status = q.val<string>('SELECT status FROM users WHERE id = ?', userId);
    if (status !== 'active') return out;
    const devices = q.all<DeviceRow>('SELECT id, kind, token, auth, p256dh FROM push_devices WHERE user_id = ? ORDER BY id', userId);
    if (!devices.length) return out;
    const data = payload.data ?? {};
    const url = payload.url ?? (typeof data.url === 'string' ? data.url : null);
    const body = payload.body ?? undefined;

    const web = devices.filter(d => d.kind === 'web' && d.auth && d.p256dh);
    const webPayload = JSON.stringify({ title: payload.title, body: body ?? null, data, url });
    await Promise.all(web.map(async d => {
      try {
        await pushTransports.web({ endpoint: d.token, keys: { p256dh: d.p256dh!, auth: d.auth! } }, webPayload);
        out.sent++;
      } catch (err) {
        const code = statusOf(err);
        if ([401, 403, 404, 410].includes(code)) { removeDevice(d.id); out.removed++; }
        else console.warn(`[push] web send failed (${code || (err as Error)?.message})`);
      }
    }));

    const expo = devices.filter(d => d.kind === 'expo');
    for (let i = 0; i < expo.length; i += EXPO_BATCH) {
      const batch = expo.slice(i, i + EXPO_BATCH);
      try {
        const tickets = await pushTransports.expo(batch.map(d => ({ to: d.token, title: payload.title, body, data: { ...data, ...(url ? { url } : {}) }, sound: 'default' as const })));
        batch.forEach((d, j) => {
          const t = tickets[j];
          if (t?.status === 'ok' || !t) { out.sent++; return; }
          if (t.details?.error === 'DeviceNotRegistered') { removeDevice(d.id); out.removed++; }
          else console.warn(`[push] expo ticket error: ${t.details?.error ?? t.message ?? 'unknown'}`);
        });
      } catch (err) { console.warn(`[push] expo batch failed: ${(err as Error)?.message}`); }
    }
    if (out.sent || out.removed) {
      q.run(`UPDATE push_devices SET last_used_at = ? WHERE user_id = ?`, nowIso(), userId);
      if (!config.isTest) console.log(`[push] user ${userId}: sent ${out.sent}, removed ${out.removed}`);
    }
  } catch (err) { console.error('[push] unexpected', (err as Error)?.message); }
  return out;
}
