/** معالج الأخطاء: رموزنا فقط تصل العميل — أخطاء المكتبات (SQLITE_BUSY، ENOENT) لا تكشف محرّك التخزين ولا حالته */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler, AppError } from '../src/lib/errors.ts';

type Body = { error: { code: string; message: string; details?: unknown } };

function handle(err: unknown): { status: number; body: Body } {
  let status = 0;
  let body = {} as Body;
  const res = { status(s: number) { status = s; return this; }, json(b: Body) { body = b; return this; } };
  errorHandler(err, {} as never, res as never, (() => {}) as never);
  return { status, body };
}

test('خطأ قاعدة البيانات لا يُسرّب رمزه: 503 برمز الضغط العابر ورسالة عربية موحّدة', () => {
  const busy = handle(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }));
  assert.equal(busy.status, 503);
  assert.equal(busy.body.error.code, 'service_unavailable', 'رمز عابر يُعيد العميل المحاولة عليه — لا SQLITE_BUSY');
  assert.equal(busy.body.error.message, 'تعذّر إكمال العملية. حاول مرة أخرى.');
  assert.equal(handle(Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' })).body.error.code, 'service_unavailable');
});

test('أخطاء النظام والمكتبات الأخرى تبقى 500 برمز عام', () => {
  const fsErr = handle(Object.assign(new Error('no such file'), { code: 'ENOENT' }));
  assert.equal(fsErr.status, 500);
  assert.equal(fsErr.body.error.code, 'server_error');
  const thirdParty = handle(Object.assign(new Error('nope'), { code: 'AUTH_REFUSED', statusCode: 403 }));
  assert.equal(thirdParty.body.error.code, 'server_error');
  assert.equal(thirdParty.body.error.message, 'nope', 'أخطاء 4xx تبقى برسالتها كما كانت');
});

test('أخطاؤنا تمرّ كما هي: الرمز والرسالة والتفاصيل', () => {
  const app = handle(new AppError('learner_limit', 'تجاوزت عدد المتعلّمين', 409, [{ field: 'name', message: 'مطلوب' }]));
  assert.equal(app.status, 409);
  assert.equal(app.body.error.code, 'learner_limit');
  assert.equal(app.body.error.message, 'تجاوزت عدد المتعلّمين');
  assert.deepEqual(app.body.error.details, [{ field: 'name', message: 'مطلوب' }]);
  const otp = handle(new AppError('otp_delivery_unavailable', 'الإرسال متوقف مؤقتاً. حاول لاحقاً', 503));
  assert.equal(otp.status, 503);
  assert.equal(otp.body.error.code, 'otp_delivery_unavailable');
  assert.equal(otp.body.error.message, 'الإرسال متوقف مؤقتاً. حاول لاحقاً');
});
