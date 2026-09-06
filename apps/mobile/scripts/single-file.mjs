// يبني نسخة العرض (بلا خادم) كملف HTML واحد يحوي كل شيء: الحزمة، الخطوط، pdf.js، وملفات الكتب التجريبية.
// الاستعمال: node scripts/single-file.mjs [مجلد الإخراج]   →  <مجلد>/index.html
// يصلح لأي استضافة تقبل صفحة واحدة (بما فيها مسارات غير جذرية): الصفحة تعيد ضبط مسارها إلى "/" قبل تشغيل الموجّه.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist-single'));
const exportDir = path.join(out, 'export');
const require = createRequire(path.join(root, '..', 'api', 'package.json'));

if (process.env.SKIP_EXPORT !== '1' || !fs.existsSync(path.join(exportDir, 'index.html'))) {
fs.rmSync(exportDir, { recursive: true, force: true });
execSync(`npx expo export --platform web --output-dir ${JSON.stringify(exportDir)}`, {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_DEMO: '1', EXPO_PUBLIC_API_URL: '', EXPO_PUBLIC_BASE_URL: '', EXPO_WEB_OUTPUT: 'single', CI: '1' },
});
}

const indexHtml = fs.readFileSync(path.join(exportDir, 'index.html'), 'utf8');
const scripts = [...indexHtml.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
if (scripts.length !== 1) throw new Error(`expected a single bundle, found ${scripts.length}: ${scripts.join(', ')}`);
// أجزاء غير متزامنة (مثل قارئ الباركود في expo-camera) لا تُحمَّل إلا عند طلبها؛ التطبيق لا يطلبها، فنكتفي بالتنبيه
const chunks = fs.readdirSync(path.join(exportDir, '_expo/static/js/web')).filter(f => !scripts[0].endsWith(f));
if (chunks.length) console.warn(`تنبيه: أجزاء غير مضمَّنة (تُحمَّل عند الطلب فقط): ${chunks.join(', ')}`);
const reset = indexHtml.match(/<style id="expo-reset">[\s\S]*?<\/style>/)?.[0] ?? '';
const bundle = fs.readFileSync(path.join(exportDir, scripts[0].replace(/^\//, '')), 'utf8');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const mime = { ttf: 'font/ttf', otf: 'font/otf', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon' };
const map = {};
// الخطوط والصور التي يطلبها التطبيق فعلاً (عائلة الأيقونات المستعملة + أوزان الخط العربي المحمَّلة)
const wanted = /ReadexPro_(400|500|600|700)|BalooBhaijaan2_(700|800)|Ionicons\.|expo-router\/assets/;
for (const f of walk(path.join(exportDir, 'assets'))) {
  const rel = '/' + path.relative(exportDir, f).split(path.sep).join('/');
  if (!wanted.test(rel)) continue;
  const ext = path.extname(f).slice(1);
  map[rel] = `data:${mime[ext] ?? 'application/octet-stream'};base64,${fs.readFileSync(f).toString('base64')}`;
}
// pdf.js من الحزمة نفسها المستعملة في الخادم (لا CDN)
for (const n of ['pdf.min.js', 'pdf.worker.min.js']) map[`/static/pdfjs/${n}`] = fs.readFileSync(require.resolve(`pdfjs-dist/build/${n}`), 'utf8');
// ملفات الكتب التجريبية (base64 خام — يفكّها العارض داخل الصفحة)
const demoDir = path.join(root, '..', '..', 'docs', 'app', 'demo');
for (const f of fs.existsSync(demoDir) ? fs.readdirSync(demoDir) : []) if (f.endsWith('.pdf')) map[`/demo/${f}`] = fs.readFileSync(path.join(demoDir, f)).toString('base64');

const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const boot = `
window.__MN_INLINE__=${safe(JSON.stringify(map))};
(function(){
  // الوضع الليلي المحفوظ يُطبَّق على الخلفية قبل تشغيل التطبيق (لا وميض)
  try{var pf=JSON.parse(localStorage.getItem('mn_prefs')||'{}');var dk=pf.themePref==='dark'||(pf.themePref!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(dk){document.documentElement.style.background='#0E0F12';document.addEventListener('DOMContentLoaded',function(){document.body.style.background='#0E0F12'})}}catch(e){}
  // الموجّه يقرأ المسار من العنوان: نثبّته على الجذر كي تعمل الصفحة من أي مسار استضافة
  try{if(location.pathname!=='/')history.replaceState(null,'','/'+location.search+location.hash)}catch(e){}
  var map=window.__MN_INLINE__;
  var key=function(u){try{return new URL(u,location.href).pathname}catch(e){return u.split('?')[0]}};
  var fix=function(s){return s.replace(/url\\((['"]?)([^'")]+)\\1\\)/g,function(m,q,u){var p=key(u);return map[p]?'url("'+map[p]+'")':m})};
  // expo-font يحقن @font-face كعقدة نصية ثم يقيس العرض فوراً (تخطيط متزامن) — لذا نبدّل المسار عند إنشاء العقدة لا بعدها
  var ctn=document.createTextNode.bind(document);document.createTextNode=function(d){return ctn(typeof d==='string'&&d.indexOf('url(')>=0?fix(d):d)};
  var FF=window.FontFace;if(FF){window.FontFace=function(f,src,d){return new FF(f,typeof src==='string'?fix(src):src,d)};window.FontFace.prototype=FF.prototype}
  var img=function(n){var s=n.getAttribute&&n.getAttribute('src');if(!s||s.slice(0,5)==='data:')return;var p=key(s);if(map[p])n.setAttribute('src',map[p])};
  new MutationObserver(function(ms){ms.forEach(function(m){
    if(m.type==='attributes'){img(m.target);return}
    m.addedNodes.forEach(function(n){
      // expo-font يضيف كل @font-face كعقدة نصية داخل <style id="expo-generated-fonts"> بعد إدراجه فارغاً
      if(n.nodeType===3){if(n.parentNode&&n.parentNode.nodeName==='STYLE'&&n.data.indexOf('url(')>=0)n.data=fix(n.data);return}
      if(n.nodeType!==1)return;
      if(n.nodeName==='STYLE'&&n.textContent.indexOf('/assets/')>=0)n.textContent=fix(n.textContent);
      else if(n.nodeName==='IMG')img(n);
      if(n.querySelectorAll)n.querySelectorAll('img').forEach(img)})})
  }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
})();`;

const html = `<title>منصّة</title>
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
${reset}
<style>body{background:#F7F5F0;margin:0}</style>
<script>${boot}</script>
<div id="root"></div>
<script>${safe(bundle)}</script>
`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(`single-file build → ${path.join(out, 'index.html')} (${(html.length / 1048576).toFixed(1)} MB, ${Object.keys(map).length} inline assets)`);
