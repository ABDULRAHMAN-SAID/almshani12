import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

/** المراسلة: المرفقات والردود والدعم (قراءة لا كتابة) وإشعار الرسالة */
let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

/** ملف خاص مملوك لمستخدم بعينه (التوقيع لا يقرأ الملف من القرص) */
const file = (ownerId: number, name: string) =>
  Number(c.q.run("INSERT INTO files (owner_id, storage_path, original_name, mime, size, visibility, purpose) VALUES (?,?,?,?,?,'private','attachment')",
    ownerId, `attachment/${ownerId}-${name}`, name, 'application/pdf', 10).lastInsertRowid);
const startConv = async (token: string, teacherId: number) => (await c.api('/api/conversations', { method: 'POST', token, body: { userId: teacherId } })).json.id as number;
const send = (token: string, convId: number, body: unknown) => c.api(`/api/conversations/${convId}/messages`, { method: 'POST', token, body });

test('المرفق يُفحص لكل نوع: رسالة نصّية بـ fileId لا توقّع رابطاً لملف الغير', async () => {
  const t = await c.teacher('96000001');
  const s = await c.student('96000002');
  const conv = await startConv(s.token, t.id);
  const teacherFile = file(t.id, 'passport.pdf');
  const own = file(s.id, 'mine.pdf');
  const sneak = await send(s.token, conv, { kind: 'text', body: 'مرحباً', fileId: teacherFile });
  assert.equal(sneak.status, 201);
  assert.equal(sneak.json.fileUrl, null, 'لا رابط موقّع لملف لا يملكه المرسِل');
  assert.equal(c.q.val('SELECT file_id FROM messages WHERE id = ?', sneak.json.id), null, 'الرسالة النصّية لا تُخزّن مرفقاً');
  assert.equal((await send(s.token, conv, { kind: 'file', fileId: teacherFile })).status, 400, 'مرفق مملوك للطرف الآخر مرفوض');
  assert.equal((await send(s.token, conv, { kind: 'file' })).status, 400, 'مرفق ناقص مرفوض');
  const good = await send(s.token, conv, { kind: 'file', fileId: own });
  assert.equal(good.status, 201);
  assert.ok(good.json.fileUrl?.includes(`/api/files/${own}`));
});

test('الردّ لا يُقبل إلا على رسالة في المحادثة نفسها', async () => {
  const t = await c.teacher('96000011');
  const a = await c.student('96000012');
  const b = await c.student('96000013');
  const convA = await startConv(a.token, t.id);
  const convB = await startConv(b.token, t.id);
  const first = await send(a.token, convA, { kind: 'text', body: 'سؤال' });
  assert.equal(first.status, 201);
  const missing = await send(b.token, convB, { kind: 'text', body: 'ردّ', replyToId: 999999 });
  assert.equal(missing.status, 400, 'معرّف غير موجود → طلب خاطئ لا خطأ خادم');
  assert.equal(missing.json.error.message, 'الرسالة المُقتبسة غير موجودة');
  assert.equal((await send(b.token, convB, { kind: 'text', body: 'ردّ', replyToId: first.json.id })).status, 400, 'اقتباس من محادثة أخرى مرفوض');
  const ok = await send(t.token, convA, { kind: 'text', body: 'الجواب', replyToId: first.json.id });
  assert.equal(ok.status, 201); assert.equal(ok.json.replyToId, first.json.id);
});

test('الدعم يقرأ المحادثة ولا يكتب فيها، وقراءته لا تُسقط «غير المقروء» عند الطرفين', async () => {
  const t = await c.teacher('96000021');
  const s = await c.student('96000022');
  const support = await c.staff('96000023', 'support');
  const conv = await startConv(s.token, t.id);
  assert.equal((await send(s.token, conv, { kind: 'text', body: 'سؤال أول' })).status, 201);
  assert.equal((await send(s.token, conv, { kind: 'text', body: 'سؤال ثانٍ' })).status, 201);
  const inject = await send(support.token, conv, { kind: 'text', body: 'رسالة من الطاقم' });
  assert.equal(inject.status, 403, 'الطاقم لا يكتب في محادثة خاصّة');
  assert.equal(inject.json.error.message, 'المراسلة بين الطالب والمعلّم فقط');
  assert.equal((await c.api(`/api/conversations/${conv}/messages`, { token: support.token })).status, 200, 'القراءة للدعم تبقى');
  const teacherView = await c.api('/api/conversations', { token: t.token });
  assert.equal(teacherView.json.find((x: any) => x.id === conv).unread, 2, 'قراءة الدعم لا تختم رسائل الطالب');
  assert.equal((await c.api(`/api/conversations/${conv}/messages`, { token: t.token })).status, 200);
  const after = await c.api('/api/conversations', { token: t.token });
  assert.equal(after.json.find((x: any) => x.id === conv).unread, 0, 'قراءة المعلّم نفسه تختم');
});

test('رسالة من حساب لم يضبط اسمه بعد تصل إشعاراً بعنوان عام', async () => {
  const t = await c.teacher('96000031');
  const fresh = await c.login('96000032'); // حساب جديد: display_name فارغ
  assert.equal(c.q.val('SELECT display_name FROM profiles WHERE user_id = ?', fresh.id), '');
  const conv = await startConv(fresh.token, t.id);
  assert.equal((await send(fresh.token, conv, { kind: 'text', body: 'سلام عليكم' })).status, 201);
  const note = c.q.get<any>("SELECT * FROM notifications WHERE user_id = ? AND type = 'message' ORDER BY id DESC LIMIT 1", t.id);
  assert.ok(note, 'الإشعار لا يسقط لأن اسم المرسِل فارغ');
  assert.equal(note.title, 'رسالة جديدة');
  assert.equal(note.body, 'سلام عليكم');
});
