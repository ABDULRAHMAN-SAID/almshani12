import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '@/api/client';
import { viewerHtml, parseViewerMessage, type ViewerMessage } from '@/lib/pdfViewer';
import type { PdfViewProps, PdfViewHandle } from './PdfView';

/** الويب: iframe معزول بمحتوى مضمَّن — لا رابط دائم يظهر في شريط العنوان */
export const PdfView = forwardRef<PdfViewHandle, PdfViewProps>(function PdfView({ url, startPage, maxPages, onMessage }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [fallback, setFallback] = useState(false);
  // داخل iframe بـ srcdoc لا تُحلّ المسارات النسبية — نحوّلها إلى روابط مطلقة أولاً
  const abs = (u: string) => (typeof window !== 'undefined' ? new URL(u, window.location.href).href : u);
  const html = useMemo(() => viewerHtml({ url: abs(url), startPage, maxPages, assetBase: abs(api.base || '/').replace(/\/$/, '') }), [url, startPage, maxPages]);
  useImperativeHandle(ref, () => ({ goto: (page) => frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'goto', page }), '*') }), []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.source !== frame.current?.contentWindow) return; const m = parseViewerMessage(e.data); if (!m) return; if (m.type === 'error' && m.message === 'pdfjs' && !fallback) { setFallback(true); return; } onMessage?.(m); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onMessage, fallback]);
  // عند تعذّر pdf.js: عارض المتصفح المدمج بلا شريط أدوات
  if (fallback) return <iframe ref={frame} src={`${abs(url)}#toolbar=0&navpanes=0`} title="reader" style={{ flex: 1, width: '100%', height: '100%', border: 0, background: '#F1EEE7' }} />;
  return <iframe ref={frame} srcDoc={html} title="reader" sandbox="allow-scripts allow-same-origin" style={{ flex: 1, width: '100%', height: '100%', border: 0, background: '#F1EEE7' }} />;
});
export type { PdfViewProps, PdfViewHandle };
