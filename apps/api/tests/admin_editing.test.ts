import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

/** ما تحتاجه لوحة الإدارة للتصحيح بعد الإنشاء: تعديل الكوبون، سياسة إلغاء سليمة، قرار بسبب، وقرار محتوى في محلّه */
let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

const post = (token: string, pathname: string, body?: unknown) => c.api(pathname, { method: 'POST', token, body });
const patch = (token: string, pathname: string, body?: unknown) => c.api(pathname, { method: 'PATCH', token, body });
const put = (token: string, pathname: string, body?: unknown) => c.api(pathname, { method: 'PUT', token, body });

const COUPON = {
  code: 'EDITME', type: 'percentage', value: 10, startsAt: null, endsAt: null,
  usageLimit: 100, userLimit: 1, active: true, scope: { category: 'book' },
};

test('الكوبون يُعدَّل بالكامل بعد الإنشاء، ويبقى تبديل التفعيل وحده ممكناً', async () => {
  const fin = await c.staff('96100001', 'finance');
  const created = await post(fin.token, '/api/admin/coupons', COUPON);
  assert.equal(created.status, 201);
  const id = created.json.id as number;

  // تعديل كامل: القيمة والسقوف والنطاق والتاريخ
  const edited = await patch(fin.token, `/api/admin/coupons/${id}`, {
    ...COUPON, code: 'edited1', value: 25, usageLimit: 5, userLimit: 2,
    startsAt: '2030-01-01T00:00:00.000Z', endsAt: '2030-02-01T00:00:00.000Z',
    scope: { teacherId: fin.id, featured: true, title: 'خصم الافتتاح' },
  });
  assert.equal(edited.status, 200, edited.text);
  const row = c.q.get<any>('SELECT * FROM coupons WHERE id = ?', id);
  assert.equal(row.code, 'EDITED1', 'الرمز يُحفظ بحروف كبيرة');
  assert.equal(row.value, 25);
  assert.equal(row.usage_limit, 5);
  assert.equal(row.user_limit, 2);
  assert.equal(row.ends_at, '2030-02-01T00:00:00.000Z');
  assert.deepEqual(JSON.parse(row.scope), { teacherId: fin.id, featured: true, title: 'خصم الافتتاح' });

  // تبديل التفعيل وحده لا يمسّ باقي الحقول
  assert.equal((await patch(fin.token, `/api/admin/coupons/${id}`, { active: false })).status, 200);
  const off = c.q.get<any>('SELECT * FROM coupons WHERE id = ?', id);
  assert.equal(off.active, 0);
  assert.equal(off.value, 25, 'الإيقاف لا يعيد القيمة القديمة');
});

test('تعديل الكوبون يرفض القيم غير الصالحة والرمز المكرَّر ومعرّفاً غير موجود', async () => {
  const fin = await c.staff('96100002', 'finance');
  const a = await post(fin.token, '/api/admin/coupons', { ...COUPON, code: 'FIRSTC' });
  const b = await post(fin.token, '/api/admin/coupons', { ...COUPON, code: 'SECOND' });
  assert.equal(a.status, 201); assert.equal(b.status, 201);

  const bad = await patch(fin.token, `/api/admin/coupons/${b.json.id}`, { ...COUPON, code: 'SECOND', value: 0 });
  assert.equal(bad.status, 422, bad.text);
  assert.ok(bad.json.error.details?.some((d: any) => d.field === 'value'), 'يعيد الحقل الخاطئ');

  const dup = await patch(fin.token, `/api/admin/coupons/${b.json.id}`, { ...COUPON, code: 'FIRSTC' });
  assert.equal(dup.status, 409, dup.text);

  assert.equal((await patch(fin.token, '/api/admin/coupons/99999', { ...COUPON, code: 'NOPE12' })).status, 404);

  const support = await c.staff('96100003', 'support');
  assert.equal((await patch(support.token, `/api/admin/coupons/${b.json.id}`, { active: false })).status, 403);
});

test('سياسة الإلغاء ترفض ساعات مكرّرة وتشترط قاعدة صفر', async () => {
  const admin = await c.staff('96100004', 'admin');
  const dup = await put(admin.token, '/api/admin/settings', { cancellation_policy: [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 24, refundPercent: 50 }, { hoursBefore: 0, refundPercent: 0 }] });
  assert.equal(dup.status, 422, dup.text);

  const noZero = await put(admin.token, '/api/admin/settings', { cancellation_policy: [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 12, refundPercent: 50 }] });
  assert.equal(noZero.status, 422, noZero.text);

  const ok = await put(admin.token, '/api/admin/settings', { cancellation_policy: [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 6, refundPercent: 40 }, { hoursBefore: 0, refundPercent: 0 }] });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((c.settings.get<any[]>('cancellation_policy')).length, 3);
});

test('رفض المعلّم أو إيقافه يشترط سبباً مكتوباً', async () => {
  const t = await c.teacher('96100011', { status: 'pending' });
  const admin = await c.staff('96100012', 'admin');
  const path = `/api/admin/teachers/${t.id}/decision`;

  const bare = await post(admin.token, path, { decision: 'rejected' });
  assert.equal(bare.status, 422, bare.text);
  assert.ok(bare.json.error.details?.some((d: any) => d.field === 'reason'));
  assert.equal((await post(admin.token, path, { decision: 'rejected', reason: 'لا' })).status, 422, 'سبب أقصر من ٣ أحرف');
  assert.equal(c.q.val<string>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', t.id), 'pending');

  assert.equal((await post(admin.token, path, { decision: 'rejected', reason: 'المستندات غير مقروءة' })).status, 200);
  assert.equal(c.q.val<string>('SELECT verification_status FROM teacher_profiles WHERE user_id = ?', t.id), 'rejected');
  // القرارات الموجبة تبقى بلا سبب
  assert.equal((await post(admin.token, path, { decision: 'under_review' })).status, 200);
});

test('قرار المحتوى لا يُطبَّق إلا على «بانتظار المراجعة»', async () => {
  const t = await c.teacher('96100021');
  const reviewer = await c.staff('96100022', 'content_reviewer');
  const published = c.book(t.id, { status: 'published' });
  const pending = c.book(t.id, { status: 'pending_review', price: 4 });

  const late = await post(reviewer.token, `/api/admin/content/book/${published}/decision`, { decision: 'rejected', reason: 'تراجعت' });
  assert.equal(late.status, 409, late.text);
  assert.equal(c.q.val<string>('SELECT status FROM books WHERE id = ?', published), 'published');

  const ok = await post(reviewer.token, `/api/admin/content/book/${pending}/decision`, { decision: 'approved', reason: null });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(c.q.val<string>('SELECT status FROM books WHERE id = ?', pending), 'published');
});

test('حذف عنصر المنهج يسجّل اسمه في السجلّ لا رقمه فقط', async () => {
  const admin = await c.staff('96100031', 'admin');
  const created = await post(admin.token, '/api/admin/catalog/countries', { code: 'QQ', name: 'دولة تجريبية' });
  assert.equal(created.status, 201, created.text);
  assert.equal((await c.api(`/api/admin/catalog/countries/${created.json.id}`, { method: 'DELETE', token: admin.token })).status, 200);
  const row = c.q.get<any>("SELECT * FROM audit_logs WHERE action = 'catalog.delete' AND entity_id = ? ORDER BY id DESC", created.json.id);
  assert.equal(JSON.parse(row.meta).name, 'دولة تجريبية');
});
