/** مطابقة الخادم للعقود المشتركة: أنواع الإشعارات، وسيلة الطلب المجاني، نطاق الكوبون المميّز، وصيغة المال */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Notification, NotificationType, Order, PurchasesFeed, Coupon, HomeFeed, PaymentMethod, formatMoney } from '@manassah/shared';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tsFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? tsFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));

test('كل نوع إشعار يُصدره الخادم موجود في NotificationType', () => {
  const known = new Set(NotificationType.options as readonly string[]);
  const emitted = new Set<string>();
  for (const file of tsFiles(srcDir)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!/\bnotify(Many|Staff)?\(/.test(line)) continue;
      // من `type:` حتى `title:` بعد إسقاط المقارنات (=== 'approved') كي لا تُحسب قيمها أنواعاً
      const seg = line.slice(line.indexOf('type:')).replace(/[=!]==?\s*'[^']*'/g, '');
      for (const m of seg.slice(0, seg.indexOf('title:') + 1 || undefined).matchAll(/'([a-z][a-z0-9_.]*)'/g)) emitted.add(m[1]!);
    }
  }
  // أنواع تُمرَّر عبر متغيّر/خريطة (التذكيرات وقرار اعتماد المعلّم) لا يلتقطها المسح النصّي
  for (const t of ['lesson_in_1h', 'lesson_in_15m', 'teacher_verified', 'teacher_rejected']) emitted.add(t);
  assert.ok(emitted.size >= 10, `المسح لم يجد أنواعاً كافية: ${emitted.size}`);
  const missing = [...emitted].filter(t => !known.has(t));
  assert.deepEqual(missing, [], `أنواع يُصدرها الخادم وليست في العقد: ${missing.join(', ')}`);
});

test('إشعار تعديل الرصيد يمرّ عبر عقد Notification، والنوع المجهول لا يُسقط التغذية', async () => {
  const s = await c.student('97600001');
  const fin = await c.staff('97600002', 'finance');
  const adj = await c.api(`/api/admin/users/${s.id}/wallet/adjust`, { method: 'POST', token: fin.token, body: { amount: 5, note: 'مكافأة اختبار' } });
  assert.equal(adj.status, 200);
  // نوع لا يعرفه العميل (خادم أحدث) بجانب الإشعار الحقيقي — يجب ألا يُسقط بقيّة التغذية
  c.q.run("INSERT INTO notifications (user_id, type, title, body) VALUES (?,'brand_new_type','نوع مستقبلي',NULL)", s.id);
  const feed = await c.api('/api/me/notifications', { token: s.token });
  assert.equal(feed.status, 200);
  const parsed = feed.json.data.map((n: unknown) => Notification.parse(n));
  assert.ok(parsed.some((n: { type: string }) => n.type === 'wallet_adjusted'), 'نوع تعديل الرصيد محفوظ كما هو');
  assert.ok(parsed.some((n: { type: string; title: string }) => n.title === 'نوع مستقبلي' && n.type === 'brand_new_type'), 'النوع المجهول يمرّ بلا كسر للتغذية');
});

test('طلب بقيمة صفر يُسجَّل بوسيلة free يقبلها عقد Order', async () => {
  const t = await c.teacher('97600011');
  const s = await c.student('97600012');
  const fin = await c.staff('97600013', 'finance');
  const bookId = c.book(t.id, { price: 3 });
  // كوبون ثابت يغطّي السعر كاملاً ⇒ إجمالي صفر يُنفَّذ فوراً بلا بوابة
  assert.equal((await c.api('/api/admin/coupons', { method: 'POST', token: fin.token, body: { code: 'ALLFREE', type: 'fixed', value: 50, startsAt: null, endsAt: null, usageLimit: null, userLimit: null, active: true, scope: {} } })).status, 201);
  const buy = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock', couponCode: 'ALLFREE', items: [{ itemType: 'book', itemId: bookId }] } });
  assert.equal(buy.status, 200, buy.text);
  assert.equal(buy.json.paid, true);
  assert.equal(buy.json.order.total, 0);
  assert.equal(buy.json.order.provider, 'free');
  Order.parse(buy.json.order);
  const purchases = await c.api('/api/me/purchases', { token: s.token });
  PurchasesFeed.parse(purchases.json);
});

test('كوبون «عرض في الرئيسية» يحتفظ بـ featured/title ويظهر في تغذية الرئيسية', async () => {
  const fin = await c.staff('97600021', 'finance');
  const s = await c.student('97600022');
  const created = await c.api('/api/admin/coupons', {
    method: 'POST', token: fin.token,
    body: { code: 'HOMEFEAT', type: 'percentage', value: 10, startsAt: null, endsAt: null, usageLimit: null, userLimit: null, active: true, scope: { featured: true, title: 'عرض الرئيسية' } },
  });
  assert.equal(created.status, 201, created.text);
  assert.deepEqual(JSON.parse(c.q.val<string>('SELECT scope FROM coupons WHERE id = ?', created.json.id)!), { featured: true, title: 'عرض الرئيسية' });
  const list = await c.api('/api/admin/coupons', { token: fin.token });
  const row = Coupon.parse(list.json.find((x: { code: string }) => x.code === 'HOMEFEAT'));
  assert.equal(row.scope.featured, true);
  assert.equal(row.scope.title, 'عرض الرئيسية');
  const home = await c.api('/api/home', { token: s.token });
  const feed = HomeFeed.parse(home.json);
  assert.ok(feed.offers.some(o => o.code === 'HOMEFEAT' && o.title === 'عرض الرئيسية'), 'العرض المميّز في الرئيسية بعنوانه');
});

test('وصف وسيلة المحفظة بصيغة العملة نفسها المعروضة في التطبيق', async () => {
  const s = await c.student('97600031');
  const w = await import('../src/services/wallet.ts');
  w.credit(s.id, 33, {});
  const methods = await c.api('/api/checkout/methods', { token: s.token });
  const wallet = methods.json.map((m: unknown) => PaymentMethod.parse(m)).find((m: { id: string }) => m.id === 'wallet');
  assert.ok(wallet, 'وسيلة المحفظة متاحة');
  assert.equal(wallet.description, `الرصيد المتاح: ${formatMoney(33)}`);
  assert.ok(wallet.description.includes('ر.ع'), wallet.description);
  assert.equal(formatMoney(2.5, { locale: 'en' }), 'OMR 2.500', 'الإنجليزية بالرمز الدولي لا بالرمز العربي');
});
