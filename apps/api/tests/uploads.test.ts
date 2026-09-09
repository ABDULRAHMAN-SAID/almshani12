import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n');

/** رفع متعدّد الأجزاء بالشكل الذي يرسله التطبيق */
async function put(c: Ctx, pathname: string, token: string, body: Uint8Array, type: string, name = 'a.bin', field = 'file') {
  const form = new FormData();
  form.append(field, new Blob([body], { type }), name);
  const res = await fetch(c.base + pathname, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* غير JSON */ }
  return { status: res.status, json, text };
}

test('الأنواع التي تُنفَّذ كمستند (SVG وHTML) مرفوضة في كل غرض يُخدَم لاحقاً', async () => {
  const s = await c.student('96100001');
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  for (const purpose of ['avatar', 'cover', 'attachment', 'document']) {
    const r = await put(c, `/api/files?purpose=${purpose}`, s.token, svg, 'image/svg+xml', 'x.svg');
    assert.ok(r.status === 400 || r.status === 403, `SVG مقبول في ${purpose}: ${r.status} ${r.text}`);
  }
  const html = await put(c, '/api/files?purpose=attachment', s.token, new TextEncoder().encode('<script>alert(1)</script>'), 'text/html', 'h.html');
  assert.equal(html.status, 400);
  assert.equal(html.json.error.message, 'نوع الملف غير مسموح لهذا الغرض');
  assert.equal(c.q.val('SELECT COUNT(*) FROM files WHERE owner_id = ?', s.id), 0, 'لم يُخزَّن شيء');
});

test('ملفّ مخزَّن غير آمن العرض يُسلَّم مرفقاً محايداً مع منع التنفيذ', async () => {
  const t = await c.teacher('96100011');
  const storage = await import('../src/services/storage.ts');
  // ملف قديم بقي في المخزن من قبل التشديد
  const f = storage.storeFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
    { ownerId: t.id, originalName: 'ملخص.svg', mime: 'image/svg+xml', purpose: 'avatar', visibility: 'public' });
  const res = await fetch(`${c.base}/api/files/public/${f.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.ok(res.headers.get('content-disposition')?.startsWith('attachment;'), 'يُنزَّل لا يُعرض');
  assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  // الصورة النقطية تبقى معروضة داخل الصفحة
  const png = storage.storeFile(Buffer.from(PNG), { ownerId: t.id, originalName: 'ok.png', mime: 'image/png', purpose: 'avatar', visibility: 'public' });
  const ok = await fetch(`${c.base}/api/files/public/${png.id}`);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.ok(ok.headers.get('content-disposition')?.startsWith('inline;'));
});

test('أخطاء الرفع أخطاء عميل: الحجم ٤١٣ والحقل الخاطئ والغرض المجهول ٤٠٠ برسالة عربية', async () => {
  const s = await c.student('96100021');
  const big = await put(c, '/api/files?purpose=avatar', s.token, new Uint8Array(9 * 1024 * 1024), 'image/png', 'big.png');
  assert.equal(big.status, 413);
  assert.equal(big.json.error.code, 'file_too_large');
  assert.match(big.json.error.message, /٨|8/, 'الرسالة تذكر الحدّ');
  const field = await put(c, '/api/files?purpose=avatar', s.token, PNG, 'image/png', 'a.png', 'image');
  assert.equal(field.status, 400);
  assert.equal(field.json.error.code, 'validation_error');
  // مفاتيح Object.prototype لم تعد أغراضاً صالحة
  for (const purpose of ['constructor', 'toString', 'hasOwnProperty']) {
    const r = await put(c, `/api/files?purpose=${purpose}`, s.token, PNG, 'image/png', 'a.png');
    assert.equal(r.status, 400, purpose);
    assert.equal(r.json.error.message, 'غرض الملف غير معروف');
  }
});

test('الغرض من الاستعلام وحده: حقل في الجسم لا يمنح قاعدة غرض آخر', async () => {
  const s = await c.student('96100031');
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'a.png');
  form.append('purpose', 'avatar');
  const res = await fetch(`${c.base}/api/files`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` }, body: form });
  assert.equal(res.status, 201);
  const j = await res.json() as any;
  assert.equal(j.url, null, 'لم يصر ملفاً عاماً');
  assert.equal(c.q.val('SELECT purpose FROM files WHERE id = ?', j.id), 'attachment');
});

test('نوع الملف من بايتاته: PNG معلَن PDF يُرفض قبل أن يصير ملف كتاب مدفوع', async () => {
  const t = await c.teacher('96100041');
  const lie = await put(c, '/api/files?purpose=book', t.token, PNG, 'application/pdf', 'book.pdf');
  assert.equal(lie.status, 400);
  assert.equal(lie.json.error.message, 'محتوى الملف لا يطابق نوعه المعلن');
  const real = await put(c, '/api/files?purpose=book', t.token, PDF, 'application/pdf', 'book.pdf');
  assert.equal(real.status, 201);
  assert.equal(real.json.mime, 'application/pdf');
  // الاسم العربي يصل سليماً ويعود في filename* بترميز UTF-8
  const ar = await put(c, '/api/files?purpose=attachment', t.token, PDF, 'application/pdf', 'ملخص الحصة.pdf');
  assert.equal(ar.status, 201);
  assert.equal(c.q.val('SELECT original_name FROM files WHERE id = ?', ar.json.id), 'ملخص الحصة.pdf');
  const storage = await import('../src/services/storage.ts');
  const url = storage.signedUrl(ar.json.id, t.id).url.replace(/^http:\/\/[^/]+/, c.base);
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-disposition')?.includes(`filename*=UTF-8''${encodeURIComponent('ملخص الحصة.pdf')}`));
});

test('الأغراض الثقيلة للمعلّمين وحدهم، وللحساب حصّة تخزين', async () => {
  const s = await c.student('96100051');
  const t = await c.teacher('96100052');
  const denied = await put(c, '/api/files?purpose=video', s.token, new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), 'video/mp4', 'v.mp4');
  assert.equal(denied.status, 403);
  assert.equal(c.q.val('SELECT COUNT(*) FROM files WHERE owner_id = ?', s.id), 0);
  const ok = await put(c, '/api/files?purpose=video', t.token, new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), 'video/mp4', 'v.mp4');
  assert.equal(ok.status, 201);

  // الحصّة موجودة فعلاً: حساب تجاوزها يُردّ بـ 413 برمز يفهمه العميل لا بـ«حاول مرة أخرى»
  const filler = (ownerId: number, mb: number) =>
    c.q.run("INSERT INTO files (owner_id, storage_path, original_name, mime, size, visibility, purpose) VALUES (?,?,?,?,?,'private','attachment')",
      ownerId, `attachment/${ownerId}-${mb}`, 'old.pdf', 'application/pdf', mb * 1024 * 1024);
  filler(s.id, 512);
  const full = await put(c, '/api/files?purpose=attachment', s.token, PDF, 'application/pdf', 'more.pdf');
  assert.equal(full.status, 413);
  assert.equal(full.json.error.code, 'quota_exceeded');
  // وحصّة المعلّم تُقاس بمضاعفات حدّ الملف الواحد: من يرفع فيديو ٢٠٠ م.ب لا يقف عند ٥١٢ م.ب
  filler(t.id, 512);
  assert.equal((await put(c, '/api/files?purpose=attachment', t.token, PDF, 'application/pdf', 'more.pdf')).status, 201);
});

test('صورة الحساب: ملف بغرض avatar فقط، وإزالتها تقطع الرابط العام', async () => {
  const s = await c.student('96100061');
  const doc = await put(c, '/api/files?purpose=document', s.token, PNG, 'image/png', 'id.png');
  assert.equal(doc.status, 201);
  const flip = await c.api('/api/me', { method: 'PATCH', token: s.token, body: { avatarFileId: doc.json.id } });
  assert.equal(flip.status, 400, 'وثيقة خاصة لا تصير صورة حساب عامة');
  assert.equal(c.q.val('SELECT visibility FROM files WHERE id = ?', doc.json.id), 'private');
  assert.equal((await fetch(`${c.base}/api/files/public/${doc.json.id}`)).status, 404);

  const av = await put(c, '/api/files?purpose=avatar', s.token, PNG, 'image/png', 'me.png');
  assert.equal((await c.api('/api/me', { method: 'PATCH', token: s.token, body: { avatarFileId: av.json.id } })).status, 200);
  assert.equal((await fetch(`${c.base}/api/files/public/${av.json.id}`)).status, 200);
  assert.equal((await c.api('/api/me', { method: 'PATCH', token: s.token, body: { avatarFileId: null } })).status, 200);
  assert.equal(c.q.val('SELECT visibility FROM files WHERE id = ?', av.json.id), 'private');
  assert.equal((await fetch(`${c.base}/api/files/public/${av.json.id}`)).status, 404, 'الرابط العام انقطع مع إزالة الصورة');

  // وإعادة اختيار الصورة نفسها تُعيد نشرها: بلا ذلك يشير avatar_path إلى ملف لم يعد عاماً فيردّ الرابط 404 رغم نجاح الحفظ
  const back = await c.api('/api/me', { method: 'PATCH', token: s.token, body: { avatarFileId: av.json.id } });
  assert.equal(back.status, 200);
  assert.equal(c.q.val('SELECT visibility FROM files WHERE id = ?', av.json.id), 'public');
  assert.equal((await fetch(`${c.base}/api/files/public/${av.json.id}`)).status, 200, 'الصورة المُعاد اختيارها تُفتح فعلاً');
  assert.ok(String(back.json.avatarUrl).endsWith(`/api/files/public/${av.json.id}`));
});

test('صور آيفون HEIC تُقبل: حاوية ftyp نفسها في mp4، والعلامة التجارية هي ما يفصلهما', async () => {
  const s = await c.student('96100065');
  // ISO-BMFF: طول الصندوق ثم 'ftyp' ثم العلامة التجارية
  const iso = (brand: string) => {
    const b = new Uint8Array(24);
    b.set([0, 0, 0, 0x18], 0);
    b.set(new TextEncoder().encode('ftyp'), 4);
    b.set(new TextEncoder().encode(brand), 8);
    return b;
  };
  const heic = await put(c, '/api/files?purpose=avatar', s.token, iso('heic'), 'image/heic', 'photo.heic');
  assert.equal(heic.status, 201, heic.text);
  assert.equal(heic.json.mime, 'image/heic');
  assert.equal((await c.api('/api/me', { method: 'PATCH', token: s.token, body: { avatarFileId: heic.json.id } })).status, 200);
  assert.equal((await fetch(`${c.base}/api/files/public/${heic.json.id}`)).status, 200);
  // والفصل يعمل في الاتجاهين: mp4 يبقى فيديو فلا يمرّ صورةً
  const mp4 = await put(c, '/api/files?purpose=avatar', s.token, iso('isom'), 'image/heic', 'fake.heic');
  assert.equal(mp4.status, 400, 'فيديو مُعلَن صورةً يُرفض');
});

test('استبدال ملف كتاب أو غلاف يحذف السابق بدل تركه بلا مرجع', async () => {
  const t = await c.teacher('96100071');
  const bookId = c.book(t.id, { price: 1, status: 'draft' });
  const before = c.q.val<number>('SELECT file_id FROM book_files WHERE book_id = ? AND kind = ?', bookId, 'full');
  const rep = await put(c, `/api/books/${bookId}/files?kind=full`, t.token, PDF, 'application/pdf', 'new.pdf');
  assert.equal(rep.status, 201);
  assert.equal(c.q.val('SELECT COUNT(*) FROM files WHERE id = ?', before), 0, 'النسخة السابقة حُذفت');
  const cover = await put(c, `/api/books/${bookId}/files?kind=cover`, t.token, PNG, 'image/png', 'c.png');
  assert.equal(cover.status, 201);
  const cover2 = await put(c, `/api/books/${bookId}/files?kind=cover`, t.token, PNG, 'image/png', 'c2.png');
  assert.equal(cover2.status, 201);
  assert.equal(c.q.val('SELECT COUNT(*) FROM files WHERE id = ?', cover.json.fileId), 0, 'الغلاف السابق حُذف');
  // النوع من الاستعلام وحده: غلاف بحدّ الكتاب (٦٠ م.ب) لم يعد ممكناً
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'c.png');
  form.append('kind', 'cover');
  const noKind = await fetch(`${c.base}/api/books/${bookId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${t.token}` }, body: form });
  assert.equal(noKind.status, 400);
});

test('صورة المتعلّم كصورة الحساب: غرض avatar فقط، وإزالتها تقطع الرابط العام', async () => {
  const p = await c.parent('96100081', [{ name: 'ابن', grade: 12, subjects: ['physics'] }]);
  const learnerId = p.learnerIds[0];
  const doc = await put(c, '/api/files?purpose=document', p.token, PNG, 'image/png', 'id.png');
  const bad = await c.api(`/api/me/learners/${learnerId}`, { method: 'PATCH', token: p.token, body: { avatarFileId: doc.json.id } });
  assert.equal(bad.status, 400, 'وثيقة خاصة لا تصير صورة متعلّم عامة');
  assert.equal(c.q.val('SELECT visibility FROM files WHERE id = ?', doc.json.id), 'private');

  const av = await put(c, '/api/files?purpose=avatar', p.token, PNG, 'image/png', 'kid.png');
  assert.equal((await c.api(`/api/me/learners/${learnerId}`, { method: 'PATCH', token: p.token, body: { avatarFileId: av.json.id } })).status, 200);
  assert.equal((await fetch(`${c.base}/api/files/public/${av.json.id}`)).status, 200);
  assert.equal((await c.api(`/api/me/learners/${learnerId}`, { method: 'PATCH', token: p.token, body: { avatarFileId: null } })).status, 200);
  assert.equal(c.q.val('SELECT visibility FROM files WHERE id = ?', av.json.id), 'private');
  assert.equal((await fetch(`${c.base}/api/files/public/${av.json.id}`)).status, 404, 'الرابط العام انقطع مع إزالة الصورة');
});

test('استبدال مستند معلّم يحذف السابق بدل تركه بلا مرجع', async () => {
  const t = await c.teacher('96100091', { status: 'rejected' });
  const first = await put(c, '/api/files?purpose=document', t.token, PDF, 'application/pdf', 'id1.pdf');
  assert.equal((await c.api('/api/teacher/documents', { method: 'POST', token: t.token, body: { type: 'id', fileId: first.json.id } })).status, 201);
  const second = await put(c, '/api/files?purpose=document', t.token, PDF, 'application/pdf', 'id2.pdf');
  assert.equal((await c.api('/api/teacher/documents', { method: 'POST', token: t.token, body: { type: 'id', fileId: second.json.id } })).status, 201);
  assert.equal(c.q.val('SELECT COUNT(*) FROM files WHERE id = ?', first.json.id), 0, 'وثيقة الهوية المستبدَلة لا تبقى على القرص');
  assert.equal(c.q.val('SELECT file_id FROM teacher_documents WHERE teacher_id = ? AND type = ?', t.id, 'id'), second.json.id);
  assert.equal(c.q.val('SELECT status FROM teacher_documents WHERE teacher_id = ? AND type = ?', t.id, 'id'), 'submitted');
});

test('الرابط الموقّع يُعاد تفويضه عند القراءة: إيقاف الحساب يبطله فوراً لا بعد انتهاء مدّته', async () => {
  const t = await c.teacher('96100101');
  const s = await c.student('96100102');
  const storage = await import('../src/services/storage.ts');
  const f = storage.storeFile(Buffer.from(PDF), { ownerId: t.id, originalName: 'ملخص.pdf', mime: 'application/pdf', purpose: 'attachment' });
  const link = storage.signedUrl(f.id, s.id, 3600);
  assert.equal((await fetch(c.base + link.url.replace(/^https?:\/\/[^/]+/, ''))).status, 200);
  c.q.run("UPDATE users SET status = 'suspended' WHERE id = ?", s.id);
  assert.equal((await fetch(c.base + link.url.replace(/^https?:\/\/[^/]+/, ''))).status, 403, 'رابط ساعة كامل بيد حساب موقوف');
  c.q.run("UPDATE users SET status = 'active' WHERE id = ?", s.id);
  assert.equal((await fetch(c.base + link.url.replace(/^https?:\/\/[^/]+/, ''))).status, 200, 'ويعود بعودة الحساب');
});
