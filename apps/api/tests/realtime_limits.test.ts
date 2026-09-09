/** حدود الطبقة الفورية: مصافحات Socket.IO لا تمرّ بوسائط express، فسقفها يُفرض في engine.io نفسه */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

// المحدِّد يُفعَّل لهذا الملف وحده؛ سقف الـ API يبقى واسعاً كي لا يمنع تسجيل الدخول
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.RATE_LIMIT_API = '1000';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

test('مصافحات Socket.IO تحت سقف لكل عنوان — بلا عدّاد كانت بلا سقف مهما ضاقت حدود express', async () => {
  const { io } = await import('socket.io-client');
  const s = await c.student('96900001');
  const open: ReturnType<typeof io>[] = [];
  const connect = () => new Promise<string | null>(resolve => {
    const sock = io(c.base, { auth: { token: s.token }, transports: ['websocket'], reconnection: false });
    open.push(sock);
    sock.on('connect', () => resolve(null));
    sock.on('connect_error', e => resolve(e.message || 'error'));
  });
  try {
    // السقف ٦٠ مصافحة في الدقيقة لكل عنوان
    for (let i = 0; i < 60; i++) assert.equal(await connect(), null, `المصافحة ${i + 1} كان يجب أن تمرّ`);
    assert.notEqual(await connect(), null, 'المصافحة ٦١ تتجاوز السقف فتُرفض قبل التحقّق من الرمز');
  } finally { for (const sock of open) sock.disconnect(); await new Promise(r => setTimeout(r, 200)); }
});
