/**
 * عارض PDF داخل التطبيق (pdf.js مستضاف على خادمنا — لا CDN خارجي؛ الملف يُجلب من رابطنا الموقّع فقط).
 * الصفحات تُرسَم على canvas عند الاقتراب منها، وتُبلَّغ الصفحة الحالية لتطبيق الهاتف عبر postMessage.
 */
export function viewerHtml({ url, startPage = 1, maxPages = 0, assetBase }: { url: string; startPage?: number; maxPages?: number; assetBase: string }): string {
  const lib = `${assetBase}/static/pdfjs`;
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;background:#F1EEE7;height:100%;overflow:auto;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#pages{display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px 0}canvas{max-width:100%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08)}
#status{font:15px system-ui,sans-serif;color:#686868;text-align:center;padding:40px 16px}</style>
<script src="${lib}/pdf.min.js"></script></head>
<body oncontextmenu="return false"><div id="status">جارٍ تحميل الكتاب…</div><div id="pages"></div>
<script>
const post=(m)=>{const s=JSON.stringify(m);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);else if(window.parent!==window)window.parent.postMessage(s,'*')};
const URL_=${JSON.stringify(url)},START=${Number(startPage) || 1},MAX=${Number(maxPages) || 0},DPR=window.devicePixelRatio||1;
(async()=>{try{if(!window.pdfjsLib)throw new Error('pdfjs');
pdfjsLib.GlobalWorkerOptions.workerSrc='${lib}/pdf.worker.min.js';
const pdf=await pdfjsLib.getDocument({url:URL_}).promise;const n=MAX?Math.min(pdf.numPages,MAX):pdf.numPages;
post({type:'loaded',pages:pdf.numPages,shown:n});document.getElementById('status').remove();
const wrap=document.getElementById('pages');const width=Math.min(document.body.clientWidth-16,900);
const first=await pdf.getPage(1);const r=first.getViewport({scale:1});const ratio=r.height/r.width;
const rendered=new Set();
async function render(c){const i=Number(c.dataset.page);if(rendered.has(i))return;rendered.add(i);const page=await pdf.getPage(i);const vp=page.getViewport({scale:(width/page.getViewport({scale:1}).width)*DPR});c.width=vp.width;c.height=vp.height;await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;}
for(let i=1;i<=n;i++){const c=document.createElement('canvas');c.dataset.page=i;c.style.width=width+'px';c.style.height=Math.round(width*ratio)+'px';wrap.appendChild(c);}
const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){render(e.target);if(e.intersectionRatio>0.5)post({type:'page',page:Number(e.target.dataset.page)})}})},{threshold:[0.01,0.5],rootMargin:'700px 0px'});
document.querySelectorAll('canvas').forEach(c=>io.observe(c));
const go=(p)=>{const c=document.querySelector('canvas[data-page="'+p+'"]');if(c){render(c);c.scrollIntoView({behavior:'smooth',block:'start'})}};
window.addEventListener('message',ev=>{try{const m=typeof ev.data==='string'?JSON.parse(ev.data):ev.data;if(m&&m.type==='goto')go(m.page)}catch(e){}});
window.__goto=go;if(START>1)setTimeout(()=>go(START),300);
}catch(e){post({type:'error',message:String(e&&e.message||e)});document.getElementById('status').textContent='تعذّر عرض الملف';}})();
</script></body></html>`;
}

export type ViewerMessage = { type: 'loaded'; pages: number; shown: number } | { type: 'page'; page: number } | { type: 'error'; message: string };
export const parseViewerMessage = (raw: unknown): ViewerMessage | null => {
  try { const m = typeof raw === 'string' ? JSON.parse(raw) : raw; return m && typeof m.type === 'string' ? m as ViewerMessage : null; } catch { return null; }
};
