/**
 * خوادم TURN الديناميكية: شكل Twilio وشكل Metered، الفشل يعود للقائمة الثابتة، والتخزين المؤقّت لا يعيد الجلب.
 * المتغيّرات تُضبط قبل استيراد config (يُقرأ مرة واحدة) — مصدر TURN هنا Twilio لأن مفاتيحه موجودة.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', `test-turn-${process.pid}`);
Object.assign(process.env, {
  NODE_ENV: 'test', DATA_DIR: dataDir, STORAGE_DIR: path.join(dataDir, 'storage'), DB_FILE: ':memory:',
  TWILIO_ACCOUNT_SID: 'ACturn', TWILIO_AUTH_TOKEN: 'tok', METERED_API_KEY: 'mk', METERED_DOMAIN: 'manassah', TURN_TTL: '600',
});
const { config } = await import('../src/config.ts');
const { getIceServers, fetchTurnServers, resetTurnCache } = await import('../src/services/turn.ts');

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];
let mode: 'ok' | 'fail' = 'ok';
const reply = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
before(() => {
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    if (mode === 'fail') throw new TypeError('fetch failed');
    if (url.includes('twilio.com')) return reply({ ice_servers: [{ url: 'stun:global.stun.twilio.com:3478', urls: 'stun:global.stun.twilio.com:3478' }, { url: 'turn:global.turn.twilio.com:3478?transport=udp', urls: 'turn:global.turn.twilio.com:3478?transport=udp', username: 'u1', credential: 'c1' }] });
    if (url.includes('metered.live')) return reply([{ urls: 'stun:stun.relay.metered.ca:80' }, { urls: 'turn:global.relay.metered.ca:80', username: 'mu', credential: 'mc' }]);
    return reply({}, 404);
  }) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* تجاهل */ } });
beforeEach(() => { calls = []; mode = 'ok'; resetTurnCache(); });

test('المصدر المستنتج Twilio، وشكل Twilio يُحوَّل إلى { urls, username, credential } مع Basic auth وTtl', async () => {
  assert.equal(config.rooms.turn.source, 'twilio');
  const servers = await getIceServers();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.twilio.com/2010-04-01/Accounts/ACturn/Tokens.json');
  assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.body, 'Ttl=600');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('ACturn:tok').toString('base64')}`);
  const turn = servers.find(s => s.urls === 'turn:global.turn.twilio.com:3478?transport=udp');
  assert.deepEqual(turn, { urls: 'turn:global.turn.twilio.com:3478?transport=udp', username: 'u1', credential: 'c1' });
  // القائمة الثابتة (STUN من config) تبقى في المقدّمة
  assert.deepEqual(servers[0], config.rooms.iceServers[0]);
  assert.equal(servers.length, config.rooms.iceServers.length + 2);
});

test('شكل Metered (مصفوفة مباشرة) عبر fetchTurnServers', async () => {
  const servers = await fetchTurnServers('metered');
  assert.equal(calls[0].url, 'https://manassah.metered.live/api/v1/turn/credentials?apiKey=mk');
  assert.deepEqual(servers, [{ urls: 'stun:stun.relay.metered.ca:80' }, { urls: 'turn:global.relay.metered.ca:80', username: 'mu', credential: 'mc' }]);
});

test('الفشل يعود للقائمة الثابتة بلا رمي', async () => {
  mode = 'fail';
  const servers = await getIceServers();
  assert.deepEqual(servers, config.rooms.iceServers);
  assert.equal(calls.length, 1);
});

test('الطلب الثاني يأتي من التخزين المؤقّت بلا جلب جديد، وresetTurnCache يعيد الجلب', async () => {
  const a = await getIceServers();
  const b = await getIceServers();
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
  resetTurnCache();
  await getIceServers();
  assert.equal(calls.length, 2);
});
