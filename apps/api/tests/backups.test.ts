/** النسخ الاحتياطية: VACUUM INTO ينشئ ملفاً صالحاً في DATA_DIR/backups، والتقليم يبقي آخر keep، وlastBackup/backupDue يعكسان الحال */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { boot, type Ctx } from './helpers.ts';

let c: Ctx;
before(async () => { c = await boot(); });
after(() => c.close());

test('runBackup ينشئ ملفاً باسم manassah-YYYYMMDD-HHMMSS.db يحوي الجداول، وlastBackup يعيده', async () => {
  const { runBackup, lastBackup, listBackups, BACKUP_DIR, backupDue } = await import('../src/services/backups.ts');
  assert.equal(BACKUP_DIR, path.join(process.env.DATA_DIR!, 'backups'));
  assert.equal(lastBackup(), null); assert.equal(backupDue(), true);
  await c.student('92300001');
  const b = runBackup();
  assert.match(path.basename(b.file), /^manassah-\d{8}-\d{6}\.db$/);
  assert.equal(fs.existsSync(b.file), true); assert.equal(b.bytes > 0, true);
  const copy = new Database(b.file, { readonly: true });
  assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n >= 1, true);
  copy.close();
  assert.equal(lastBackup()?.file, b.file); assert.equal(listBackups().length, 1); assert.equal(backupDue(), false);
});

test('التقليم يبقي الأحدث فقط، والأسماء المتزامنة لا تتصادم', async () => {
  const { runBackup, listBackups, pruneBackups } = await import('../src/services/backups.ts');
  const files = [runBackup().file, runBackup().file];
  assert.notEqual(files[0], files[1]);
  assert.equal(listBackups().length, 3);
  assert.equal(pruneBackups(2), 1);
  const left = listBackups();
  assert.equal(left.length, 2);
  assert.equal(left.some(b => b.file === files[1]), true, 'الأحدث باقٍ');
});

test('POST /admin/system/backup للمدير فقط، وGET /admin/system يعرض آخر نسخة والعدد', async () => {
  const s = await c.student('92300002');
  const admin = await c.staff('92300003', 'admin');
  assert.equal((await c.api('/api/admin/system/backup', { method: 'POST', token: s.token })).status, 403);
  const r = await c.api('/api/admin/system/backup', { method: 'POST', token: admin.token });
  assert.equal(r.status, 200); assert.equal(fs.existsSync(r.json.file), true); assert.equal(typeof r.json.bytes, 'number');
  const sys = await c.api('/api/admin/system', { token: admin.token });
  assert.equal(sys.json.backups.count, 3); assert.equal(typeof sys.json.backups.last, 'string');
  assert.equal(c.q.get<any>("SELECT action FROM audit_logs WHERE action = 'system.backup'")?.action, 'system.backup');
});
