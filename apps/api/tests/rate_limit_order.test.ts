import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

// المحدِّد يُفعَّل لهذا الملف وحده (helpers يطفئه لبقية الاختبارات) وبسقف منخفض ليُستنفد بسرعة
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.RATE_LIMIT_API = '5';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

test('ردود بوابات الدفع تحت المحدِّد كبقيّة المسارات', async () => {
  for (let i = 0; i < 5; i++) await c.api('/api/config');
  assert.equal((await c.api('/api/config')).status, 429, 'السقف استُنفد');
  // كانت تُركَّب فوق المحدِّد للحفاظ على الجسم الخام، فبقيت مفتوحة بلا سقف رغم أنها بلا مصادقة
  const hook = await c.api('/api/payments/mock/confirm', { method: 'POST', body: { reference: 'x' } });
  assert.equal(hook.status, 429);
  assert.equal(hook.json.error.code, 'rate_limited');
});
