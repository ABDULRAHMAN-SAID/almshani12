// يتحقّق بعد `expo export` أن حزمة الويب الحقيقية (التي يخدمها الخادم) ليست نسخة عرض بلا خادم.
// EXPO_PUBLIC_DEMO يُضمَّن وقت التحويل، وذاكرة Metro قد تُعيد حزمة بُنيت بقيمة أخرى؛ src/api/client.ts يطبع علامة البناء كسلسلة ثابتة.
// الاستعمال: node scripts/check-web-build.mjs [مجلد dist]
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] || 'dist');
const dir = path.join(dist, '_expo/static/js/web');
if (!fs.existsSync(dir)) { console.error(`خطأ: لا توجد حزمة ويب في ${dir}`); process.exit(1); }
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
const has = (f, mark) => fs.readFileSync(path.join(dir, f), 'utf8').includes(mark);
const demo = files.filter(f => has(f, 'manassah-build:demo'));
const api = files.filter(f => has(f, 'manassah-build:api'));
if (demo.length || !api.length) {
  console.error(demo.length ? `خطأ: حزمة الويب تحوي وضع العرض (بيانات تجريبية بلا خادم): ${demo.join(', ')}` : 'خطأ: لم نجد علامة بناء الخادم في أي حزمة');
  console.error('أعد البناء: npm run web:build (يستعمل --clear لتجاوز ذاكرة Metro)');
  process.exit(1);
}
console.log(`حزمة الويب سليمة: نسخة الخادم (${api.join(', ')})`);
