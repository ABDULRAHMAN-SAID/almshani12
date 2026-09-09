/** إعدادات الإقلاع الحسّاسة: الرمز الثابت لا يمرّ في الإنتاج، وفترة النسخ لا تصير صفراً — تُقرأ من عملية مستقلّة لأن config يُحسم مرة واحدة عند الاستيراد */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(here, '..', 'src', 'config.ts');

type Boot = { fixedCode: string | null; everyHours: number };

/** يستورد config.ts في عملية جديدة ببيئة معطاة ويعيد ما يهمّنا منها */
function bootConfig(env: Record<string, string>): Boot {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manassah-cfg-'));
  try {
    const code = `const { config } = await import(${JSON.stringify(CONFIG)});`
      + ` console.log(JSON.stringify({ fixedCode: config.otp.fixedCode, everyHours: config.backups.everyHours }));`;
    const out = execFileSync(process.execPath, ['--import', 'tsx', '-e', code], {
      cwd: path.join(here, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATA_DIR: dir, STORAGE_DIR: path.join(dir, 'storage'), NODE_ENV: 'production', OTP_FIXED_CODE: '', ALLOW_INSECURE_OTP: '', BACKUP_EVERY_HOURS: '', ...env },
    });
    return JSON.parse(out.trim().split('\n').pop()!) as Boot;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('الإنتاج يتجاهل OTP_FIXED_CODE الذي تمرّره ملفات النشر، وALLOW_INSECURE_OTP=1 وحده يفتحه', () => {
  assert.equal(bootConfig({ OTP_FIXED_CODE: '000000' }).fixedCode, null, 'رمز ثابت في الإنتاج = دخول أي أحد بحساب المدير');
  assert.equal(bootConfig({ OTP_FIXED_CODE: '000000', ALLOW_INSECURE_OTP: '1' }).fixedCode, '000000');
  assert.equal(bootConfig({ NODE_ENV: 'development' }).fixedCode, '000000');
  assert.equal(bootConfig({ NODE_ENV: 'development', OTP_FIXED_CODE: 'none' }).fixedCode, null);
});

test('BACKUP_EVERY_HOURS غير الموجب يعود إلى الافتراضي، والصغير جداً يُرفع إلى ربع ساعة', () => {
  assert.equal(bootConfig({ BACKUP_EVERY_HOURS: '0' }).everyHours, 24);
  assert.equal(bootConfig({ BACKUP_EVERY_HOURS: '-3' }).everyHours, 24);
  assert.equal(bootConfig({ BACKUP_EVERY_HOURS: '0.05' }).everyHours, 0.25);
  assert.equal(bootConfig({ BACKUP_EVERY_HOURS: '6' }).everyHours, 6);
  assert.equal(bootConfig({}).everyHours, 24);
});

test('الإنتاج لا يعيد devCode في ردّ طلب الرمز مهما كان الإعداد', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manassah-otp-'));
  const APP = path.join(here, '..', 'src', 'index.ts');
  try {
    const code = `const app = await import(${JSON.stringify(APP)});`
      + ` const { seedCatalog } = await import(${JSON.stringify(path.join(here, '..', 'src', 'db', 'seed.ts'))});`
      + ` const { server } = app.createApp(); seedCatalog();`
      + ` await new Promise(r => server.listen(0, '127.0.0.1', r));`
      + ` const base = 'http://127.0.0.1:' + server.address().port;`
      + ` const res = await fetch(base + '/api/auth/otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'phone', target: '+96899000000' }) });`
      + ` console.log(JSON.stringify({ status: res.status, body: await res.json() })); server.close(); process.exit(0);`;
    const out = execFileSync(process.execPath, ['--import', 'tsx', '-e', code], {
      cwd: path.join(here, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, NODE_ENV: 'production', DATA_DIR: dir, STORAGE_DIR: path.join(dir, 'storage'), DB_FILE: path.join(dir, 'db.sqlite'),
        JWT_SECRET: 'x'.repeat(40), SIGNING_SECRET: 'y'.repeat(40), RATE_LIMIT_ENABLED: 'false',
        // أسوأ إعداد ممكن: الرمز الثابت مفتوح صراحةً — ومع ذلك لا يخرج في الردّ
        OTP_FIXED_CODE: '000000', ALLOW_INSECURE_OTP: '1', OTP_TEST_TARGETS: '+96899000000', ALLOW_DEMO_SEED: '',
      },
    });
    const r = JSON.parse(out.trim().split('\n').pop()!) as { status: number; body: Record<string, unknown> };
    assert.equal(r.status, 200);
    assert.equal(r.body.devCode, undefined, 'رمز دخول في ردّ عام على خادم إنتاج = دخول أي أحد بأي حساب');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
