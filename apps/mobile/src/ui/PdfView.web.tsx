import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { viewerHtml, parseViewerMessage, type ViewerMessage } from '@/lib/pdfViewer';
import type { PdfViewProps, PdfViewHandle } from './PdfView';

/** الويب: iframe معزول بمحتوى مضمَّن — لا رابط دائم يظهر في شريط العنوان */
export const PdfView = forwardRef<PdfViewHandle, PdfViewProps>(function PdfView({ url, startPage, maxPages, onMessage }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => viewerHtml({ url, startPage, maxPages }), [url, startPage, maxPages]);
  useImperativeHandle(ref, () => ({ goto: (page) => frame.current?.contentWindow?.postMessage(JSON.stringify({ type: 'goto', page }), '*') }), []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.source !== frame.current?.contentWindow) return; const m = parseViewerMessage(e.data); if (m) onMessage?.(m); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onMessage]);
  return <iframe ref={frame} srcDoc={html} title="reader" sandbox="allow-scripts allow-same-origin" style={{ flex: 1, width: '100%', height: '100%', border: 0, background: '#F1EEE7' }} />;
});
export type { PdfViewProps, PdfViewHandle };
