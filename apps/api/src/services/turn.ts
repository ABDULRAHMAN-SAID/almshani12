import { config } from '../config.ts';

/**
 * خوادم ICE (STUN/TURN) للفيديو المباشر: القائمة الثابتة من config دائماً، ويُضاف إليها TURN ديناميكي
 * ببيانات مؤقّتة من Twilio (خدمة عبور الشبكة) أو Metered حسب config.rooms.turn.source.
 * تُخزَّن النتيجة مؤقّتاً حتى قبل انتهاء الصلاحية بدقيقة؛ عند الفشل يُسجَّل مرة واحدة ونكتفي بالقائمة الثابتة.
 */
export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export type TurnSource = 'static' | 'twilio' | 'metered' | 'none';

const TIMEOUT_MS = 8_000;
let cache: { servers: IceServer[]; expiresAt: number } | null = null;
let failureLogged = false;

async function call(url: string, init: RequestInit = {}): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

const normalize = (raw: unknown): IceServer[] => (Array.isArray(raw) ? raw : [])
  .filter((s: any) => s && (typeof s.urls === 'string' || Array.isArray(s.urls) || typeof s.url === 'string'))
  .map((s: any) => ({ urls: s.urls ?? s.url, ...(s.username ? { username: String(s.username) } : {}), ...(s.credential ? { credential: String(s.credential) } : {}) }));

/** يجلب خوادم TURN المؤقّتة من المصدر المطلوب (بلا تخزين) — يرمي عند الفشل */
export async function fetchTurnServers(source: TurnSource, ttlSeconds = config.rooms.turn.ttlSeconds): Promise<IceServer[]> {
  if (source === 'twilio') {
    const { accountSid, authToken } = config.otp.sms.twilio;
    const data = await call(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `Ttl=${ttlSeconds}`,
    });
    return normalize(data?.ice_servers);
  }
  if (source === 'metered') {
    const { apiKey, domain } = config.rooms.turn.metered;
    return normalize(await call(`https://${domain}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`));
  }
  return [];
}

const key = (s: IceServer) => (Array.isArray(s.urls) ? s.urls : [s.urls]).join(',');

/** القائمة النهائية التي تُرسَل للعميل عند دخول القاعة */
export async function getIceServers(): Promise<IceServer[]> {
  const base = [...config.rooms.iceServers] as IceServer[];
  const { source, ttlSeconds } = config.rooms.turn;
  if (source !== 'twilio' && source !== 'metered') return base;
  if (cache && cache.expiresAt > Date.now()) return cache.servers;
  try {
    const dynamic = await fetchTurnServers(source, ttlSeconds);
    const seen = new Set(base.map(key));
    const servers = [...base, ...dynamic.filter(s => !seen.has(key(s)))];
    cache = { servers, expiresAt: Date.now() + Math.max(60, ttlSeconds - 60) * 1000 };
    failureLogged = false;
    return servers;
  } catch (err) {
    if (!failureLogged) { failureLogged = true; console.error(`[turn] ${source} credentials failed — using static ICE list:`, (err as Error)?.message); }
    return base;
  }
}

/** للاختبارات */
export function resetTurnCache(): void { cache = null; failureLogged = false; }
