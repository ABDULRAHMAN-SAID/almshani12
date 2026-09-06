import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '@manassah/tokens';
import { api } from '@/api/client';
import { viewerHtml, parseViewerMessage, type ViewerMessage } from '@/lib/pdfViewer';

export interface PdfViewProps { url: string; startPage?: number; maxPages?: number; onMessage?: (m: ViewerMessage) => void }
export interface PdfViewHandle { goto: (page: number) => void }

/** الجوال: WebView بلا شريط أدوات ولا مشاركة — المحتوى يبقى داخل التطبيق */
export const PdfView = forwardRef<PdfViewHandle, PdfViewProps>(function PdfView({ url, startPage, maxPages, onMessage }, ref) {
  const web = useRef<WebView>(null);
  useImperativeHandle(ref, () => ({ goto: (page) => web.current?.injectJavaScript(`window.__goto && window.__goto(${page}); true;`) }), []);
  return (
    <WebView
      ref={web}
      source={{ html: viewerHtml({ url, startPage, maxPages }), baseUrl: api.base }}
      originWhitelist={['*']}
      onMessage={e => { const m = parseViewerMessage(e.nativeEvent.data); if (m) onMessage?.(m); }}
      javaScriptEnabled domStorageEnabled={false} allowsLinkPreview={false} setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures={false} dataDetectorTypes="none" style={styles.web}
    />
  );
});

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: colors.bg.subtle } });
