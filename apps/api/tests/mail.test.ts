/**
 * البريد المعاملاتي بمرسِل مستبدل (SMTP): إيصال بعد تنفيذ الطلب يحمل رقمه وإجماليه، وتأكيد حجز باسم المتعلّم والمعلّم،
 * ولا إرسال لحساب بلا بريد. رموز التحقّق ما زالت تمرّ عبر غلاف otp-transports فوق المرسِل نفسه.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Ctx } from './helpers.ts';

Object.assign(process.env, { SMTP_HOST: 'smtp.test', SMTP_USER: 'u', SMTP_PASS: 'p', EMAIL_FROM: 'noreply@test' });
const { boot } = await import('./helpers.ts');
const mail = await import('../src/services/mail.ts');
const otpTransports = await import('../src/services/otp-transports.ts');

const sent: { to: string; subject: string; html: string; text: string }[] = [];
let c: Ctx;
before(async () => {
  c = await boot();
  mail.mailer.smtpSend = async (to, subject, html, text) => { sent.push({ to, subject, html, text }); };
});
after(() => c.close());
const tick = () => new Promise(r => setTimeout(r, 30));

test('sendMail يختار SMTP ويعيد true؛ وغلاف رموز التحقّق يمرّ عبر المرسِل نفسه', async () => {
  assert.equal(mail.mailEnabled(), true);
  assert.equal(await mail.sendMail({ to: 'a@test', subject: 'x', html: '<b>x</b>', text: 'x' }), true);
  await otpTransports.smtpSend('b@test', 'otp', '<i>1</i>', '1');
  assert.deepEqual(sent.map(m => m.to), ['a@test', 'b@test']);
  sent.length = 0;
});

test('إيصال بعد الدفع: يحمل رقم الطلب والإجمالي والعناصر ورابط الطلب', async () => {
  const t = await c.teacher('96000001');
  const s = await c.student('96000002');
  c.q.run('UPDATE users SET email = ? WHERE id = ?', 'student@test', s.id);
  const bookId = c.book(t.id, { price: 3.5 });
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock', items: [{ itemType: 'book', itemId: bookId }] } });
  assert.equal(ck.json.paid, false);
  const ref = new URL(ck.json.checkoutUrl).searchParams.get('ref')!;
  const paid = await c.api('/api/payments/mock/confirm', { method: 'POST', body: { reference: ref } });
  assert.equal(paid.json.paid, true);
  await tick();
  const m = sent.find(x => x.to === 'student@test');
  assert.ok(m, 'أُرسل الإيصال');
  const order = ck.json.order;
  assert.ok(m.subject.includes(order.number));
  assert.ok(m.text.includes(order.number) && m.html.includes(order.number));
  assert.ok(m.text.includes('3.5 OMR') && m.html.includes('3.5 OMR'), m.text);
  assert.ok(m.html.includes('كتاب summary 3.5'));
  assert.ok(m.html.includes(`/order/${order.number}`));
  assert.ok(m.html.includes('dir="rtl"'));
  // التكرار على طلب مدفوع لا يرسل إيصالاً ثانياً
  await c.api('/api/payments/mock/confirm', { method: 'POST', body: { reference: ref } });
  await tick();
  assert.equal(sent.filter(x => x.to === 'student@test').length, 1);
});

test('لا بريد للحساب → لا إرسال (ولا خطأ)', async () => {
  const t = await c.teacher('96000011');
  const s = await c.student('96000012');
  const bookId = c.book(t.id, { price: 2 });
  const before = sent.length;
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'mock', items: [{ itemType: 'book', itemId: bookId }] } });
  const ref = new URL(ck.json.checkoutUrl).searchParams.get('ref')!;
  assert.equal((await c.api('/api/payments/mock/confirm', { method: 'POST', body: { reference: ref } })).json.paid, true);
  await tick();
  assert.equal(sent.length, before);
  assert.equal(c.q.val('SELECT status FROM orders WHERE id = ?', ck.json.order.id), 'paid');
});

test('تأكيد الحجز بعد الدفع: اسم المتعلّم والمعلّم والموعد', async () => {
  const t = await c.teacher('96000021');
  const s = await c.student('96000022');
  c.q.run('UPDATE users SET email = ? WHERE id = ?', 'parent@test', s.id);
  const startsAt = c.slotIn(48);
  const b = await c.api('/api/bookings', { method: 'POST', token: s.token, body: { teacherId: t.id, subjectId: c.cat.subjects.physics, mode: 'individual', durationMinutes: 60, startsAt } });
  assert.equal(b.status, 201);
  const w = await import('../src/services/wallet.ts');
  w.credit(s.id, 20, { type: 'topup' as any });
  const ck = await c.api('/api/checkout', { method: 'POST', token: s.token, body: { provider: 'wallet', bookingId: b.json.booking.id } });
  assert.equal(ck.json.paid, true);
  await tick();
  const mails = sent.filter(x => x.to === 'parent@test');
  const conf = mails.find(x => x.subject.startsWith('تأكيد حجز حصة'));
  assert.ok(conf, 'أُرسل تأكيد الحجز');
  assert.ok(conf.text.includes('معلّم 021') && conf.text.includes('طالب 022'), conf.text);
  assert.ok(conf.html.includes(`/booking/${b.json.booking.id}`));
  assert.ok(mails.some(x => x.subject.includes('إيصال')), 'والإيصال أيضاً');
});

test('قالب مباشر: sendBookingConfirmation يتخطّى حساباً بلا بريد ويعيد false', async () => {
  const s = await c.student('96000031');
  assert.equal(await mail.sendBookingConfirmation({ id: 1, student_id: s.id, duration_minutes: 30, mode: 'individual' }, 'x', 'y', new Date().toISOString()), false);
});
