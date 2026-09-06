/**
 * طبيب الربط: يطبع حالة كل تكامل ويفحص الاتصال فعلياً للعناصر الجاهزة والناقصة.
 *   npm run doctor -w apps/api            → سطر لكل عنصر + ملخّص، رمز الخروج 0 دائماً
 *   … -- --strict                         → رمز خروج 1 إن فشل فحص عنصر «جاهز»
 *   DOCTOR_OUT=doctor.json …              → يكتب النتيجة JSON إلى الملف (تستعمله CI لبناء تعليق PR)
 */
import fs from 'node:fs';
import { config } from '../src/config.ts';
import { migrate } from '../src/db/index.ts';
import { listIntegrations, runChecks, summary } from '../src/services/integrations.ts';

const strict = process.argv.includes('--strict');
const ICON = { ready: '✅', partial: '🟡', off: '⚪' } as const;

migrate();
const groups = listIntegrations();
const toCheck = groups.flatMap(g => g.items).filter(i => i.status !== 'off').map(i => i.id);
const checks = await runChecks(toCheck);

let failedReady = 0;
for (const g of groups) {
  console.log(`\n${g.label}`);
  for (const i of g.items) {
    const c = checks[i.id];
    const icon = c && !c.ok ? '❌' : ICON[i.status];
    if (c && !c.ok && i.status === 'ready') failedReady++;
    const tail = c ? ` — ${c.detail} (${c.ms} ms)` : '';
    const missing = i.missing.length ? ` [ينقص: ${i.missing.join(', ')}]` : '';
    console.log(`${icon} ${i.id} — ${i.label} — ${i.detail}${tail}${missing}`);
  }
}
const s = summary();
console.log(`\nالملخّص: جاهز ${s.ready} · ناقص ${s.partial} · غير مفعّل ${s.off} · فشل ${Object.values(checks).filter(c => !c.ok).length} من ${Object.keys(checks).length} فحصاً — ${config.publicUrl} (${config.env})`);

if (process.env.DOCTOR_OUT) {
  const out = {
    time: new Date().toISOString(), env: config.env, publicUrl: config.publicUrl, summary: s,
    groups: groups.map(g => ({ group: g.group, label: g.label, items: g.items.map(i => ({ ...i, check: checks[i.id] ?? null })) })),
  };
  fs.writeFileSync(process.env.DOCTOR_OUT, JSON.stringify(out, null, 2));
  console.log(`كُتبت النتيجة إلى ${process.env.DOCTOR_OUT}`);
}
process.exit(strict && failedReady ? 1 : 0);
